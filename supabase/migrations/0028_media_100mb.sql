-- Files kept for publishing: up to 100 MB (was 50 MB). Needs a Supabase plan whose global upload limit is at least
-- 100 MB (the Free plan caps every file at 50 MB): raise it first in Storage settings, then run this.
update storage.buckets set file_size_limit = 104857600 where id = 'production-media';
