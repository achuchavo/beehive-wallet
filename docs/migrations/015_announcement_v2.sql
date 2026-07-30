-- Migration 015 — announcement v2: popup modal with rich body and CTA.
--
-- The banner's single 300-char message becomes the TITLE of a popup modal.
-- Two new pieces of content ride along:
--
--   body      Markdown-ish rich text (headings/bold/lists/links only). It is
--             rendered client-side by a whitelist renderer that builds React
--             elements - the server stores it verbatim and never treats it as
--             HTML, so nothing here is sanitised into or out of markup.
--   cta_*     One optional call-to-action button. cta_path is an IN-APP route
--             ("/alarms"), never a full URL: the API rejects anything that does
--             not start with "/", so an announcement can never send users to
--             an external site under the app's own chrome.
--
-- Severity keeps its old meaning. info/warning announcements show as the modal;
-- danger stays an undismissable inline banner (system notices must not be
-- snoozable). Dismiss/snooze state lives in the client's localStorage keyed by
-- announcement id - the server stores no per-user read state.
--
-- Apply with a privileged user:
--   mysql -u chavo -p beehive_wallet < docs/migrations/015_announcement_v2.sql
--
-- BACK UP FIRST (dumps contain emails and password hashes):
--   mysqldump -u chavo -p beehive_wallet > D:\WebServer\backups\before_015.sql
-- ROLLBACK: ALTER TABLE announcements DROP COLUMN body, DROP COLUMN cta_label,
--           DROP COLUMN cta_path;  and reset schema_version to 14. Existing
--           banners lose nothing - message and severity are untouched.

ALTER TABLE announcements
    ADD COLUMN body TEXT NULL
        COMMENT 'Rich text (safe markdown subset), rendered by the client'
        AFTER message,
    ADD COLUMN cta_label VARCHAR(80) NOT NULL DEFAULT ''
        COMMENT 'CTA button text; empty = no button'
        AFTER body,
    ADD COLUMN cta_path VARCHAR(200) NOT NULL DEFAULT ''
        COMMENT 'In-app route the CTA navigates to; must start with /'
        AFTER cta_label;

INSERT INTO schema_version (version, applied_at)
VALUES (15, NOW())
ON DUPLICATE KEY UPDATE applied_at = VALUES(applied_at);
