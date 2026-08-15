# Plugin Admission

“Cordon-approved” is an artifact-specific admission verdict, not a package
label and not a claim that software is vulnerability-free. Approval binds one
wheel digest to its immutable source revision, host compatibility, policy
revision, checks verdict, SBOM, and dependency lock.

The canonical predicate is
[`cordon-plugin-admission-v1.json`](../schema/cordon-plugin-admission-v1.json).
It is deterministic and contains no signature field. A trusted CI workflow
signs the complete predicate with Sigstore keyless signing; the resulting
bundle carries the ephemeral certificate and transparency-log proof.

## Trust sequence

1. Build a wheel from an immutable source commit in isolated CI.
2. Run the Cordon checks and host conformance policy.
3. Generate and scan an SBOM and dependency lock.
4. Emit the predicate from those artifacts, never from hand-entered flags.
5. Sign it with `cosign sign-blob --bundle … --yes` under GitHub Actions OIDC.
6. At image composition, run `cordon-admission` with deployment-owned expected
   identities and the exact wheel.
7. Install only after verification; scan and sign the final image separately.
8. Deploy the final image by digest.

`cordon-admission-create` is the canonical emitter. It refuses a failing checks
verdict, a missing, duplicated, skipped, or non-passing policy-required evidence
item, mutable source revision, incompatible HQ policy, or incompatible host API.
It then hashes the wheel, checks verdict, SBOM, dependency lock, and policy
directly from disk into the predicate. The policy's `required_evidence` array is
the sole inventory; consumers should never assemble the predicate or duplicate
that inventory in a plugin repo.

After the trusted workflow's required jobs complete, it runs
`cordon-admission-evidence --policy …` to derive the passing evidence inventory
directly from that policy. This command belongs at the end of the gated job:
reaching it is the assertion that every preceding fail-fast check passed.

```sh
cordon-admission \
  --statement admission.json \
  --bundle admission.sigstore.json \
  --artifact dist/example_notes-1.2.3-py3-none-any.whl \
  --identity 'https://github.com/example/policy/.github/workflows/admit.yml@refs/heads/main' \
  --issuer 'https://token.actions.githubusercontent.com' \
  --repository example/example-notes \
  --workflow .github/workflows/admit-plugin.yml \
  --host severino-hq \
  --plugin-id example.notes \
  --policy-sha "$EXPECTED_POLICY_SHA256"
```

The command fails unless the predicate conforms, Cosign validates the bundle
and exact signing identity, the recomputed wheel name and digest match, and all
consumer-owned repository, workflow, host, plugin, and policy expectations
match the signed statement.

Each successful verification emits one canonical, deployment-safe entry.
`cordon-admission-lock --host severino-hq --entry verified.json` combines one or
more such entries into the deterministic runtime lock, sorting plugin IDs and
rejecting duplicate identities, mixed hosts, or noncanonical input. Plugin
repositories therefore never reproduce the host lock format.

Those expected values are roots of trust. They must be pinned in the consuming
deployment and must never be copied from the plugin or its statement. Accepting
plugin-controlled expectations disables the security boundary.

## Threat boundary

Admission prevents artifact substitution, unsigned predicates, unexpected
signers, mutable source references, policy substitution, and evidence swapping.
It does not prove arbitrary code harmless. Compromise of the trusted workflow,
GitHub OIDC, Sigstore trust root, Cordon policy, host runtime, or an admitted
dependency remains inside the trust boundary. Branch protection, pinned
Actions, minimal permissions, isolated builds, review, scanning, and runtime
hardening remain required defense in depth.
