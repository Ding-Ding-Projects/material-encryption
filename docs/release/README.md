# Build and release

`build.bat` restores the locked dependencies, regenerates the renderer, runs local checks, and builds the unpacked application. Silent modes are `/s`, `--silent`, and `SILENT=1`. `build-installer.bat` calls that route and then creates unsigned Squirrel.Windows setup and update artifacts.

The installer script verifies `Setup.exe`, `RELEASES`, the full package, `NotSigned` status, and SHA-256. It never publishes, tags, pushes, or creates a release.

Release automation builds and publishes on every push and manual dispatch. Tests and lint remain local and do not gate the workflow. This speeds publication but means automation may publish a commit whose local checks were skipped; release notes must state the actual evidence.
