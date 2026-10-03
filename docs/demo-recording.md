# Demo GIF recording plan

This is a capture checklist for a future 20–40 second README demo. It deliberately avoids real provider accounts, credentials, or external webhook targets. Capture only after the interface is stable enough that labels and commands will not immediately become stale.

The recording has not yet been captured. A maintainer should record the sequence below from the built CLI and local receiver, inspect every frame, then add the approved file to this repository. Do not substitute generated screen mockups for an actual run.

## Suggested sequence (about 30 seconds)

1. Show the README title and the statement that BayarLab is local and synthetic (2–3 seconds).
2. In a terminal, run `pnpm --filter @bayarlab/cli start providers` and briefly show the narrow provider profiles (4 seconds).
3. Run `pnpm --filter @bayarlab/cli start inspect midtrans settlement --output json` to show an offline signed fixture with authentication masked (6 seconds).
4. Start the local Midtrans example receiver in a second terminal, then send one settlement event to `127.0.0.1` and show the successful response (8–10 seconds).
5. Send the same event with `--invalid-signature --expect-status 401` and show the receiver rejecting it (6–8 seconds).
6. End on the docs link or repository URL, with a visible reminder that the event is synthetic (2 seconds).

## Capture and review

- Use a clean terminal, readable font size, short shell prompt, and a narrow screen area around the relevant output.
- Hide notifications, unrelated tabs, usernames, home-directory names, environment variables, and any local secrets.
- Keep the receiver and target on loopback. Do not show real merchant dashboards, transactions, customer data, or provider credentials.
- Prefer a silent GIF under roughly 10 MB; if the final recording is video, provide captions and a reduced-size preview separately.
- Review every frame for secret exposure and misleading claims before committing. Link the asset from the README only after a maintainer has captured and reviewed it.
