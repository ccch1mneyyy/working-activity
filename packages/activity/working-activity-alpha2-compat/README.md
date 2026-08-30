# DSH alpha.2 compatibility fixture

This private fixture runs the working-activity Host integration against the
published DSH `0.1.2-alpha.2` package graph. It is isolated from the main
package's rc.6 Host/Web development graph and is never published. The parent
script builds the package before installing it into this fixture.

Run it from `../working-activity` with `pnpm run test:alpha2`.
