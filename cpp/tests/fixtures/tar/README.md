These small archives were generated independently with Python's `tarfile`
module using `USTAR_FORMAT`, `GNU_FORMAT`, and `PAX_FORMAT`, then gzip compressed.
Each contains a directory, an empty header, a header whose name exceeds 100
bytes, a symlink, and a binary static library. The PAX archive also contains a
Unicode filename. They verify compatibility without using the production
decoder to build test inputs.
