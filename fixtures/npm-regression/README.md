# npm local-directory regression fixture

This is a no-symlink adaptation attempt based on [npm/cli#9433](https://github.com/npm/cli/issues/9433). It is retained only as research history and is **not** an authoritative regression golden.

Real Linux run `32337356424` showed that both npm 11.14.1 and 11.16.0 installed successfully; both later produced a non-zero inventory because removing the original symlink topology changed the reproduction. The adaptation therefore did **not** reproduce the public issue and was removed from the release gate. V0.1 continues to refuse source symlinks rather than widening that security boundary for a marketing red case.
