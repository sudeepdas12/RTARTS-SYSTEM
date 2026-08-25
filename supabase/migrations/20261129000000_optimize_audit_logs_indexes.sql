-- Optimize indexes for high-volume audit logs
CREATE INDEX IF NOT EXISTS idx_audit_table_time ON audit_logs (table_name, action_time DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action_time ON audit_logs (action, action_time DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user_time ON audit_logs (user_id, action_time DESC);
