import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  buildIncomplete,
  conflict,
  invalid,
  notFound,
  overlayUnavailable,
  precondition,
} from './errors.js';

const schemaUrl = new URL('../sql/schema.sql', import.meta.url);
const integer = (value) => Number.parseInt(value, 10);

async function rollback(client) {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original transaction error.
  }
}

function buildFromRow(row, created = false) {
  return {
    buildId: row.build_id,
    generation: row.generation,
    state: row.state,
    sourceDigest: row.source_digest,
    graphDigest: row.graph_digest,
    manifestDigest: row.manifest_digest,
    artifactCount: row.artifact_count === null ? null : integer(row.artifact_count),
    createdAt: new Date(row.created_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    created,
  };
}

function routeFromRow(row, replayed = false) {
  return {
    routeId: row.route_id,
    status: row.status,
    acceptedAt: new Date(row.accepted_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    stateRevision: integer(row.state_revision),
    buildId: row.build_id,
    generation: row.generation,
    graphDigest: row.graph_digest,
    overlayId: row.overlay_id,
    overlayDigest: row.overlay_digest,
    overlayEffectiveAt: row.overlay_effective_at ? new Date(row.overlay_effective_at) : null,
    overlayExpiresAt: row.overlay_expires_at ? new Date(row.overlay_expires_at) : null,
    overlayResolution: row.overlay_resolution,
    request: {
      sourceNodeId: row.source_node_id,
      targetNodeId: row.target_node_id,
      mode: row.mode,
      overlayPolicy: row.overlay_policy,
      maxExpansions: integer(row.max_expansions),
    },
    result: row.result_json,
    replayed,
  };
}

export async function initializeDatabase(pool) {
  await pool.query(await readFile(fileURLToPath(schemaUrl), 'utf8'));
}

export async function resetDatabase(pool, confirmation) {
  if (confirmation !== 'version-coherent-map-lab-reset') {
    throw new Error('refusing to reset without the explicit lab confirmation');
  }
  await pool.query(`
    TRUNCATE route_requests, map_publications, state_mutation_receipts,
      map_system_state, traffic_overlays, map_graph_nodes, map_artifacts, map_builds CASCADE;
    INSERT INTO map_system_state (singleton, state_revision)
    VALUES (true, 0);
  `);
}

export class MapRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async #lockIntent(client, owner, requestKey) {
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`${owner.length}:${owner}:${requestKey.length}:${requestKey}`],
    );
  }

  async #databaseNow(client) {
    const result = await client.query(`SELECT clock_timestamp() AS now`);
    return new Date(result.rows[0].now);
  }

  async #lockStateForUpdate(client) {
    const result = await client.query(`
      SELECT state_revision, current_build_id, current_overlay_id
      FROM map_system_state
      WHERE singleton = true
      FOR UPDATE
    `);
    return result.rows[0];
  }

  async #lockStateForShare(client) {
    const result = await client.query(`
      SELECT state_revision, current_build_id, current_overlay_id
      FROM map_system_state
      WHERE singleton = true
      FOR SHARE
    `);
    return result.rows[0];
  }

  async #existingMutation(client, owner, requestKey, digest) {
    const found = await client.query(
      `SELECT * FROM state_mutation_receipts WHERE owner_fingerprint = $1 AND request_key = $2`,
      [owner, requestKey],
    );
    if (!found.rowCount) return null;
    if (found.rows[0].intent_digest !== digest) {
      throw conflict('this idempotency key is already bound to a different state mutation');
    }
    return { ...found.rows[0].result_json, replayed: true };
  }

  async #recordMutation(client, { owner, requestKey, digest, operation, result, now }) {
    await client.query(`
      INSERT INTO state_mutation_receipts (
        owner_fingerprint, request_key, intent_digest, operation, http_status, result_json, created_at
      ) VALUES ($1, $2, $3, $4, 200, $5::jsonb, $6)
    `, [owner, requestKey, digest, operation, JSON.stringify(result), now]);
    return { ...result, replayed: false };
  }

  async beginBuild({ owner, requestKey, intentDigest, sourceDigest, builderContract }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.#lockIntent(client, owner, requestKey);
      const found = await client.query(
        `SELECT * FROM map_builds WHERE owner_fingerprint = $1 AND request_key = $2`,
        [owner, requestKey],
      );
      if (found.rowCount) {
        if (found.rows[0].intent_digest !== intentDigest) {
          throw conflict('this idempotency key is already bound to a different build intent');
        }
        await client.query('COMMIT');
        return buildFromRow(found.rows[0], false);
      }
      const buildId = randomUUID();
      const generation = `gen_${buildId.replaceAll('-', '')}`;
      const now = await this.#databaseNow(client);
      const inserted = await client.query(`
        INSERT INTO map_builds (
          build_id, owner_fingerprint, request_key, intent_digest, source_digest,
          builder_contract, generation, state, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'deriving', $8)
        RETURNING *
      `, [buildId, owner, requestKey, intentDigest, sourceDigest, builderContract, generation, now]);
      await client.query('COMMIT');
      return buildFromRow(inserted.rows[0], true);
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async completeBuild({ buildId, graphDigest, manifestDigest, artifacts, nodeIds }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query(`SELECT * FROM map_builds WHERE build_id = $1 FOR UPDATE`, [buildId]);
      if (!found.rowCount) throw notFound();
      const build = found.rows[0];
      if (build.state === 'complete') {
        if (
          build.graph_digest !== graphDigest
          || build.manifest_digest !== manifestDigest
          || integer(build.artifact_count) !== artifacts.length
        ) throw conflict('the complete build does not match the derived artifact set');
        await client.query('COMMIT');
        return buildFromRow(build, false);
      }
      if (build.state !== 'deriving') throw conflict('the build cannot be completed from its current state');
      if (!artifacts.length || !artifacts.some((artifact) => artifact.kind === 'graph' && artifact.digest === graphDigest)) {
        throw invalid('a complete build requires its graph artifact');
      }
      if (!Array.isArray(nodeIds) || nodeIds.length < 2 || new Set(nodeIds).size !== nodeIds.length) {
        throw invalid('a complete build requires unique graph node metadata');
      }
      for (const artifact of artifacts) {
        await client.query(`
          INSERT INTO map_artifacts (
            build_id, kind, logical_key, digest, object_key, byte_count, media_type
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          buildId,
          artifact.kind,
          artifact.logicalKey,
          artifact.digest,
          artifact.objectKey,
          artifact.bytes,
          artifact.mediaType,
        ]);
      }
      await client.query(`
        INSERT INTO map_graph_nodes (build_id, node_id)
        SELECT $1, node_id
        FROM unnest($2::text[]) AS value(node_id)
      `, [buildId, nodeIds]);
      const now = await this.#databaseNow(client);
      const updated = await client.query(`
        UPDATE map_builds
        SET state = 'complete', graph_digest = $2, manifest_digest = $3,
            artifact_count = $4, completed_at = $5
        WHERE build_id = $1
        RETURNING *
      `, [buildId, graphDigest, manifestDigest, artifacts.length, now]);
      await client.query('COMMIT');
      return buildFromRow(updated.rows[0], false);
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async getBuildById(buildId) {
    const found = await this.pool.query(`SELECT * FROM map_builds WHERE build_id = $1`, [buildId]);
    if (!found.rowCount) throw notFound();
    return buildFromRow(found.rows[0]);
  }

  async getBuildByGeneration(generation) {
    const found = await this.pool.query(`SELECT * FROM map_builds WHERE generation = $1`, [generation]);
    if (!found.rowCount) throw notFound();
    return buildFromRow(found.rows[0]);
  }

  async getCurrentState() {
    const found = await this.pool.query(`
      SELECT state.state_revision, build.build_id, build.generation, build.manifest_digest,
             overlay.overlay_id, overlay.digest AS overlay_digest,
             overlay.effective_at, overlay.expires_at,
             clock_timestamp() AS observed_at
      FROM map_system_state AS state
      LEFT JOIN map_builds AS build ON build.build_id = state.current_build_id
      LEFT JOIN traffic_overlays AS overlay ON overlay.overlay_id = state.current_overlay_id
      WHERE state.singleton = true
    `);
    const row = found.rows[0];
    return {
      stateRevision: integer(row.state_revision),
      buildId: row.build_id,
      generation: row.generation,
      manifestDigest: row.manifest_digest,
      overlayId: row.overlay_id,
      overlayDigest: row.overlay_digest,
      overlayEffectiveAt: row.effective_at ? new Date(row.effective_at) : null,
      overlayExpiresAt: row.expires_at ? new Date(row.expires_at) : null,
      observedAt: new Date(row.observed_at),
    };
  }

  async #changePublication({ owner, requestKey, digest, expectedRevision, buildId, action }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.#lockIntent(client, owner, requestKey);
      let replay = await this.#existingMutation(client, owner, requestKey, digest);
      if (replay) {
        await client.query('COMMIT');
        return replay;
      }
      const state = await this.#lockStateForUpdate(client);
      const revision = integer(state.state_revision);
      if (revision !== expectedRevision) throw precondition('current state revision changed', revision);
      let currentGeneration = null;
      if (state.current_build_id) {
        const current = await client.query(`SELECT generation FROM map_builds WHERE build_id = $1`, [state.current_build_id]);
        currentGeneration = current.rows[0]?.generation ?? null;
      }
      const targetResult = await client.query(`SELECT * FROM map_builds WHERE build_id = $1`, [buildId]);
      if (!targetResult.rowCount) throw notFound();
      const target = targetResult.rows[0];
      if (target.state !== 'complete') throw buildIncomplete();
      if (state.current_build_id === buildId) throw conflict('the requested build is already current');
      if (action === 'rollback' && state.current_build_id === null) throw conflict('there is no current build to roll back');

      const nextRevision = revision + 1;
      const now = await this.#databaseNow(client);
      const publicationId = randomUUID();
      await client.query(`
        INSERT INTO map_publications (
          publication_id, state_revision, action, build_id, previous_build_id, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `, [publicationId, nextRevision, action, buildId, state.current_build_id, now]);
      await client.query(`
        UPDATE map_system_state
        SET state_revision = $1, current_build_id = $2, current_overlay_id = NULL
        WHERE singleton = true
      `, [nextRevision, buildId]);
      const result = {
        operation: action,
        publicationId,
        stateRevision: nextRevision,
        buildId,
        generation: target.generation,
        previousBuildId: state.current_build_id,
        previousGeneration: currentGeneration,
      };
      replay = await this.#recordMutation(client, {
        owner, requestKey, digest, operation: action, result, now,
      });
      await client.query('COMMIT');
      return replay;
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  publishBuild(input) {
    return this.#changePublication({ ...input, action: 'publish' });
  }

  rollbackToBuild(input) {
    return this.#changePublication({ ...input, action: 'rollback' });
  }

  async activateOverlay({
    owner,
    requestKey,
    digest,
    expectedRevision,
    buildId,
    overlayObject,
    activatesAfterSeconds,
    ttlSeconds,
  }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.#lockIntent(client, owner, requestKey);
      let replay = await this.#existingMutation(client, owner, requestKey, digest);
      if (replay) {
        await client.query('COMMIT');
        return replay;
      }
      const state = await this.#lockStateForUpdate(client);
      const revision = integer(state.state_revision);
      if (revision !== expectedRevision) throw precondition('current state revision changed', revision);
      if (state.current_build_id !== buildId) throw conflict('overlay generation is not the current map generation');
      const currentBuild = await client.query(`SELECT generation FROM map_builds WHERE build_id = $1`, [buildId]);
      if (!currentBuild.rowCount) throw notFound();
      const now = await this.#databaseNow(client);
      const overlayId = randomUUID();
      const inserted = await client.query(`
        INSERT INTO traffic_overlays (
          overlay_id, build_id, digest, object_key, byte_count,
          accepted_at, effective_at, expires_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6::timestamptz,
          $6::timestamptz + ($7::integer * interval '1 second'),
          $6::timestamptz + (($7::integer + $8::integer) * interval '1 second')
        )
        RETURNING *
      `, [
        overlayId,
        buildId,
        overlayObject.digest,
        overlayObject.objectKey,
        overlayObject.bytes,
        now,
        activatesAfterSeconds,
        ttlSeconds,
      ]);
      const nextRevision = revision + 1;
      await client.query(`
        UPDATE map_system_state
        SET state_revision = $1, current_overlay_id = $2
        WHERE singleton = true
      `, [nextRevision, overlayId]);
      const overlay = inserted.rows[0];
      const result = {
        operation: 'activate_overlay',
        stateRevision: nextRevision,
        overlayId,
        buildId,
        generation: currentBuild.rows[0].generation,
        overlayDigest: overlay.digest,
        acceptedAt: new Date(overlay.accepted_at).toISOString(),
        effectiveAt: new Date(overlay.effective_at).toISOString(),
        expiresAt: new Date(overlay.expires_at).toISOString(),
      };
      replay = await this.#recordMutation(client, {
        owner, requestKey, digest, operation: 'activate_overlay', result, now,
      });
      await client.query('COMMIT');
      return replay;
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async beginRoute({ owner, requestKey, intentDigest, request }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.#lockIntent(client, owner, requestKey);
      const existing = await client.query(
        `SELECT * FROM route_requests WHERE owner_fingerprint = $1 AND request_key = $2`,
        [owner, requestKey],
      );
      if (existing.rowCount) {
        if (existing.rows[0].intent_digest !== intentDigest) {
          throw conflict('this idempotency key is already bound to a different route intent');
        }
        await client.query('COMMIT');
        return routeFromRow(existing.rows[0], true);
      }

      const state = await this.#lockStateForShare(client);
      if (!state.current_build_id) {
        throw conflict('no complete map generation is current');
      }
      const buildResult = await client.query(`SELECT * FROM map_builds WHERE build_id = $1`, [state.current_build_id]);
      const build = buildResult.rows[0];
      if (!build || build.state !== 'complete') throw conflict('no complete map generation is current');
      const endpoints = await client.query(`
        SELECT node_id
        FROM map_graph_nodes
        WHERE build_id = $1 AND node_id = ANY($2::text[])
      `, [state.current_build_id, [request.sourceNodeId, request.targetNodeId]]);
      if (endpoints.rowCount !== 2) throw invalid('route endpoint is not present in the current frozen graph');
      const timingResult = await client.query(`
        WITH boundary AS (SELECT clock_timestamp() AS accepted_at)
        SELECT boundary.accepted_at,
               overlay.overlay_id, overlay.build_id AS overlay_build_id,
               overlay.digest AS overlay_digest, overlay.effective_at, overlay.expires_at,
               COALESCE(
                 overlay.build_id = $2
                 AND overlay.effective_at <= boundary.accepted_at
                 AND boundary.accepted_at < overlay.expires_at,
                 false
               ) AS effective
        FROM boundary
        LEFT JOIN traffic_overlays AS overlay ON overlay.overlay_id = $1
      `, [state.current_overlay_id, state.current_build_id]);
      const timing = timingResult.rows[0];
      const acceptedAt = new Date(timing.accepted_at);
      const hasCurrentOverlay = timing.effective;
      if (!hasCurrentOverlay && request.overlayPolicy === 'require_current') throw overlayUnavailable();

      const routeId = randomUUID();
      const inserted = await client.query(`
        INSERT INTO route_requests (
          route_id, owner_fingerprint, request_key, intent_digest, status, accepted_at,
          state_revision, build_id, generation, graph_digest,
          overlay_id, overlay_digest, overlay_effective_at, overlay_expires_at, overlay_resolution,
          source_node_id, target_node_id, mode, overlay_policy, max_expansions
        ) VALUES (
          $1, $2, $3, $4, 'accepted', $5,
          $6, $7, $8, $9,
          $10, $11, $12, $13, $14,
          $15, $16, $17, $18, $19
        )
        RETURNING *
      `, [
        routeId,
        owner,
        requestKey,
        intentDigest,
        acceptedAt,
        integer(state.state_revision),
        state.current_build_id,
        build.generation,
        build.graph_digest,
        hasCurrentOverlay ? timing.overlay_id : null,
        hasCurrentOverlay ? timing.overlay_digest : null,
        hasCurrentOverlay ? timing.effective_at : null,
        hasCurrentOverlay ? timing.expires_at : null,
        hasCurrentOverlay ? 'current' : 'base_fallback',
        request.sourceNodeId,
        request.targetNodeId,
        request.mode,
        request.overlayPolicy,
        request.maxExpansions,
      ]);
      await client.query('COMMIT');
      return routeFromRow(inserted.rows[0], false);
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async completeRoute({ routeId, result }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query(`SELECT * FROM route_requests WHERE route_id = $1 FOR UPDATE`, [routeId]);
      if (!found.rowCount) throw notFound();
      if (found.rows[0].status === 'complete') {
        await client.query('COMMIT');
        return routeFromRow(found.rows[0], false);
      }
      const now = await this.#databaseNow(client);
      const updated = await client.query(`
        UPDATE route_requests
        SET status = 'complete', result_json = $2::jsonb, completed_at = $3
        WHERE route_id = $1
        RETURNING *
      `, [routeId, JSON.stringify(result), now]);
      await client.query('COMMIT');
      return routeFromRow(updated.rows[0], false);
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async getRoute({ owner, routeId }) {
    const found = await this.pool.query(
      `SELECT * FROM route_requests WHERE route_id = $1 AND owner_fingerprint = $2`,
      [routeId, owner],
    );
    if (!found.rowCount) throw notFound();
    return routeFromRow(found.rows[0], false);
  }

  async getArtifact({ generation, logicalKey }) {
    const found = await this.pool.query(`
      SELECT artifact.*, build.generation, build.state
      FROM map_builds AS build
      JOIN map_artifacts AS artifact ON artifact.build_id = build.build_id
      WHERE build.generation = $1 AND artifact.logical_key = $2
    `, [generation, logicalKey]);
    if (!found.rowCount || found.rows[0].state !== 'complete') throw notFound();
    const row = found.rows[0];
    return {
      generation: row.generation,
      kind: row.kind,
      logicalKey: row.logical_key,
      digest: row.digest,
      objectKey: row.object_key,
      bytes: integer(row.byte_count),
      mediaType: row.media_type,
    };
  }
}
