-- Commit the enum value before using it in trigger functions.
alter type public.request_status add value if not exists 'clarification_resolved';
