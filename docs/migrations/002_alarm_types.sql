-- Alarm types: per-address choice of sent / received / both / unbond,
-- with a per-direction "last seen" cursor and a kind tag on each alert.

ALTER TABLE watched_addresses
  ADD COLUMN alarm_type VARCHAR(12) NOT NULL DEFAULT 'both' AFTER alarm_enabled,
  ADD COLUMN last_seen_received_tx VARCHAR(80) NULL AFTER last_seen_tx_hash,
  ADD COLUMN last_seen_unbond_tx VARCHAR(80) NULL AFTER last_seen_received_tx;

ALTER TABLE wallet_alerts
  ADD COLUMN kind VARCHAR(12) NOT NULL DEFAULT 'sent' AFTER watched_address_id;
