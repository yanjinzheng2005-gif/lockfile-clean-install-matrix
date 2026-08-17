# npm local-directory regression fixture

This is a no-symlink adaptation of the public reproduction in [npm/cli#9433](https://github.com/npm/cli/issues/9433). The committed lockfile includes the nested local package row accepted by npm 11.14.1 and rejected by npm 11.15.0 through 11.16.0 in the original Linux report.

The Linux gate is authoritative: if this adaptation does not produce baseline PASS and candidate INSTALL_FAILED, it must not be presented as a reproduced public regression.
