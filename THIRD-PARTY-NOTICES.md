# Third-party notices

## AI Hero Skills

VPR Skills adapt methods and ideas from `mattpocock/skills`, pinned at commit
`4ae2317ddb22b046e26455e4f9c9b3aaaf62212d`. Derived VPR files are documented in
`docs/architecture/ai-hero-adaptation.md` and use original Spanish wording and
VPR-specific contracts.

```text
MIT License

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Development dependencies

Development dependencies are recorded by the lockfile and will be included in
the generated SBOM/license report before release. Current direct development
dependencies include TypeScript, the Node.js type definitions, esbuild and Husky.

## Microsoft Copilot SDK

The native Copilot adapter depends on `@microsoft/copilot-sdk` 2.0.1 (MIT),
the successor of the GitHub SDK. Its transitive dependencies and platform runtimes retain
their own licenses and notices in the installed packages and lockfile inventory.
VPR uses its stdio transport and the user's native authentication; it does not
redistribute account credentials. See https://github.com/microsoft/copilot-sdk.
This dependency's license does not decide the license or ownership of VPR.

## Optional local tools

When explicitly selected during project initialization, VPR can install Graphify
(`graphifyy` 0.9.106, via uv) and Archify MIT 2.16.0 from the upstream commit
`c826e6c3a7abad19c0f3cd1ca57207d54b1ad8de` at
https://github.com/tt-a1i/archify. These remain separate local installations;
their code is not bundled in the VPR archive. Existing installations and their
licenses are preserved. No model is invoked for indexing, graph queries, or
rendering an already-authored diagram specification.

