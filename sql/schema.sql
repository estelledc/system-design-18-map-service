CREATE TABLE IF NOT EXISTS map_builds (
  build_id uuid PRIMARY KEY,
  owner_fingerprint text NOT NULL CHECK (owner_fingerprint ~ '^[0-9a-f]{64}$'),
  request_key text NOT NULL,
  intent_digest text NOT NULL CHECK (intent_digest ~ '^[0-9a-f]{64}$'),
  source_digest text NOT NULL CHECK (source_digest ~ '^[0-9a-f]{64}$'),
  builder_contract text NOT NULL,
  generation text NOT NULL UNIQUE CHECK (generation ~ '^gen_[0-9a-f]{32}$'),
  state text NOT NULL CHECK (state IN ('deriving', 'complete', 'rejected')),
  graph_digest text CHECK (graph_digest IS NULL OR graph_digest ~ '^[0-9a-f]{64}$'),
  manifest_digest text CHECK (manifest_digest IS NULL OR manifest_digest ~ '^[0-9a-f]{64}$'),
  artifact_count integer CHECK (artifact_count IS NULL OR artifact_count > 0),
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE (owner_fingerprint, request_key),
  CHECK (
    (state = 'deriving' AND graph_digest IS NULL AND manifest_digest IS NULL AND artifact_count IS NULL AND completed_at IS NULL)
    OR (state = 'complete' AND graph_digest IS NOT NULL AND manifest_digest IS NOT NULL AND artifact_count IS NOT NULL AND completed_at IS NOT NULL)
    OR state = 'rejected'
  )
);

CREATE TABLE IF NOT EXISTS map_artifacts (
  build_id uuid NOT NULL REFERENCES map_builds(build_id),
  kind text NOT NULL CHECK (kind IN ('graph', 'tile')),
  logical_key text NOT NULL,
  digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  object_key text NOT NULL CHECK (object_key ~ '^sha256/[0-9a-f]{2}/[0-9a-f]{64}$'),
  byte_count integer NOT NULL CHECK (byte_count > 0),
  media_type text NOT NULL,
  PRIMARY KEY (build_id, logical_key)
);

CREATE TABLE IF NOT EXISTS map_graph_nodes (
  build_id uuid NOT NULL REFERENCES map_builds(build_id),
  node_id text NOT NULL,
  PRIMARY KEY (build_id, node_id)
);

CREATE TABLE IF NOT EXISTS traffic_overlays (
  overlay_id uuid PRIMARY KEY,
  build_id uuid NOT NULL REFERENCES map_builds(build_id),
  digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  object_key text NOT NULL CHECK (object_key ~ '^sha256/[0-9a-f]{2}/[0-9a-f]{64}$'),
  byte_count integer NOT NULL CHECK (byte_count > 0),
  accepted_at timestamptz NOT NULL,
  effective_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CHECK (effective_at >= accepted_at AND expires_at > effective_at)
);

CREATE TABLE IF NOT EXISTS map_system_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  state_revision bigint NOT NULL CHECK (state_revision >= 0),
  current_build_id uuid REFERENCES map_builds(build_id),
  current_overlay_id uuid REFERENCES traffic_overlays(overlay_id)
);

INSERT INTO map_system_state (singleton, state_revision)
VALUES (true, 0)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS state_mutation_receipts (
  owner_fingerprint text NOT NULL CHECK (owner_fingerprint ~ '^[0-9a-f]{64}$'),
  request_key text NOT NULL,
  intent_digest text NOT NULL CHECK (intent_digest ~ '^[0-9a-f]{64}$'),
  operation text NOT NULL CHECK (operation IN ('publish', 'rollback', 'activate_overlay')),
  http_status integer NOT NULL CHECK (http_status BETWEEN 200 AND 299),
  result_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (owner_fingerprint, request_key)
);

CREATE TABLE IF NOT EXISTS map_publications (
  publication_id uuid PRIMARY KEY,
  state_revision bigint NOT NULL UNIQUE CHECK (state_revision > 0),
  action text NOT NULL CHECK (action IN ('publish', 'rollback')),
  build_id uuid NOT NULL REFERENCES map_builds(build_id),
  previous_build_id uuid REFERENCES map_builds(build_id),
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS route_requests (
  route_id uuid PRIMARY KEY,
  owner_fingerprint text NOT NULL CHECK (owner_fingerprint ~ '^[0-9a-f]{64}$'),
  request_key text NOT NULL,
  intent_digest text NOT NULL CHECK (intent_digest ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('accepted', 'complete')),
  accepted_at timestamptz NOT NULL,
  completed_at timestamptz,
  state_revision bigint NOT NULL CHECK (state_revision > 0),
  build_id uuid NOT NULL REFERENCES map_builds(build_id),
  generation text NOT NULL,
  graph_digest text NOT NULL CHECK (graph_digest ~ '^[0-9a-f]{64}$'),
  overlay_id uuid REFERENCES traffic_overlays(overlay_id),
  overlay_digest text CHECK (overlay_digest IS NULL OR overlay_digest ~ '^[0-9a-f]{64}$'),
  overlay_effective_at timestamptz,
  overlay_expires_at timestamptz,
  overlay_resolution text NOT NULL CHECK (overlay_resolution IN ('current', 'base_fallback')),
  source_node_id text NOT NULL,
  target_node_id text NOT NULL,
  mode text NOT NULL CHECK (mode = 'drive'),
  overlay_policy text NOT NULL CHECK (overlay_policy IN ('require_current', 'base_fallback')),
  max_expansions integer NOT NULL CHECK (max_expansions > 0),
  result_json jsonb,
  UNIQUE (owner_fingerprint, request_key),
  CHECK ((status = 'accepted' AND result_json IS NULL AND completed_at IS NULL)
      OR (status = 'complete' AND result_json IS NOT NULL AND completed_at IS NOT NULL)),
  CHECK ((overlay_id IS NULL AND overlay_digest IS NULL AND overlay_effective_at IS NULL AND overlay_expires_at IS NULL
          AND overlay_resolution = 'base_fallback')
      OR (overlay_id IS NOT NULL AND overlay_digest IS NOT NULL AND overlay_effective_at IS NOT NULL
          AND overlay_expires_at IS NOT NULL AND overlay_resolution = 'current'))
);

CREATE INDEX IF NOT EXISTS route_requests_build_index ON route_requests(build_id);
CREATE INDEX IF NOT EXISTS map_artifacts_digest_index ON map_artifacts(digest);
