# Task 10 / P2.Z fix report

## Accepted findings

1. **Lease split-brain (Must Fix)**
   - Reproduced before production changes with a deterministic action overlap test: after A acquired, the registry directory was renamed and a same-mode empty directory recreated at the original pathname; B incorrectly returned `acquired: true`.
   - Lease election evidence now lives in a persistent sibling coordination directory derived from the normalized custom registry pathname. The directory is 0700 and is bound to a 0600 atomic identity anchor containing only safe path-hash and dev/ino evidence.
   - Candidate, choosing, heartbeat, release, and reclaim operations revalidate parent, coordination directory, anchor, and file identities. Old owners/reclaimers cannot unlink pathname successors. Registry replacement therefore cannot redirect lease cleanup or allow a second action to overlap.
   - Missing-anchor recovery is permitted only for an empty coordination directory; unexplained contents, identity mismatch, directory replacement, and symlink substitution fail closed.

2. **Replayable P2.Z evidence (Must Fix)**
   - Added `.superpowers/sdd/task-10-manual-verification.mjs` as a complete disposable verifier.
   - It generates sensitive values only in memory, prints only safe booleans/counts, validates cross-worktree isolation and CLI redaction, verifies the exported lock-order contract, and deletes all disposable state in `finally`.
   - `.superpowers/sdd/task-10-report.md` records the exact replay command, script SHA-256, exact safe output, cleanup evidence, focused/full test counts, and diff-check command.

3. **Management atomic temp GC (Should Fix)**
   - Extended temporary artifact recognition to management atomic-write crash artifacts and serialized deletion under a safe management-scoped mutation lock.
   - Focused coverage proves only dead stale 0600 regular candidates are removed; live-owner, fresh, symlink, and unrelated files remain untouched.

## TDD evidence

RED command:

```sh
npm run build:node && node --test --test-name-pattern 'registry directory replacement cannot split|purge removes only dead stale management' dist-node/tests-node/reviewer-session-lease.test.js dist-node/tests-node/reviewer-session-registry.test.js
```

Before implementation: 0 passed, 2 failed. The lease assertion observed B acquire after registry replacement; the GC assertion observed the dead stale management temp remain.

GREEN verification is recorded in `task-10-report.md`: focused 67/67, manual verifier completed with forbidden-value count 0 and cleanup true, full suite 643/643, and `git diff --check` clean.

## Residual boundary

Automatic recovery intentionally refuses a missing or mismatched anchor when any unexplained coordination evidence exists. Recovery requires restoring the matching coordination directory/anchor or explicit operator cleanup after proving no owner remains; silently creating a new namespace would reintroduce split-brain.

## P2.Z directed re-review fix

The remaining physical-path alias finding was reproduced and fixed without changing the lease protocol or report verifier.

RED command:

```sh
npm run build:node && node --test --test-name-pattern 'real and ancestor-symlink registry aliases share one physical lease namespace' dist-node/tests-node/reviewer-session-lease.test.js
```

Before the fix: exit 1; 0 passed, 1 failed. The deterministic assertion observed the alias-side contender return `acquired: true` while the real-path action was active.

Implementation: after creating or opening the requested registry, lease setup now resolves its physical pathname with `realpathSync.native`. Initial lexical `lstat`, physical-path `lstat`, and final lexical `lstat` must all remain private 0700 directories with identical dev/ino evidence. The resulting physical pathname is the sole input to the coordination hash and internal epoch read, so real and ancestor-symlink aliases share one persistent namespace while final-component no-follow, owner/mode checks, race fail-closed behavior, and identity-guarded cleanup remain intact.

Targeted GREEN command:

```sh
npm run build:node && node --test --test-name-pattern 'real and ancestor-symlink registry aliases share one physical lease namespace' dist-node/tests-node/reviewer-session-lease.test.js
```

Result: exit 0; 1 passed, 0 failed, 0 skipped, 0 cancelled.

Lease regression command:

```sh
npm run build:node && node --test dist-node/tests-node/reviewer-session-lease.test.js
```

Result: exit 0; 23 passed, 0 failed, 0 skipped, 0 cancelled. This includes registry replacement, coordination/anchor replacement, symlink substitution, private modes, same-path successor preservation, and stale reclaimer boundaries.

P2 focused regression command:

```sh
npm run build:node && node --test dist-node/tests-node/reviewer-session-scope.test.js dist-node/tests-node/reviewer-session-registry.test.js dist-node/tests-node/reviewer-session-lease.test.js dist-node/tests-node/reviewer-session-cli.test.js
```

Result: exit 0; 68 passed, 0 failed, 0 skipped, 0 cancelled. The manual verifier and its recorded digest/output were not changed; it imports only the lock-order constant from the lease module and does not exercise lease acquisition, so it was not rerun. The full repository suite was not rerun for this isolated namespace-normalization change; the complete P2 state-layer suite above is the risk-scoped regression gate.
