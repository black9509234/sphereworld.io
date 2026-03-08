## Goal

Move `sphere.io` to a server-authoritative model where:

- account login is verified on the server
- passwords are never stored in client storage
- sockets are accepted only for authenticated users
- inventory, equipment, drops, crafting, and stat allocation are granted only by server-side rules
- save data is stored in a real database instead of a deployment-local JSON file

## Current Risks

1. Client-side auth data exists in `localStorage`.
2. Server `join` trusts only the player name.
3. A second connection with the same name can replace the first session.
4. Save data is written to `data/profiles.json`, which is not the right long-term store for Railway deployment.
5. Socket origin is open to `*`.
6. No rate limiting exists for auth or chat spam.

## Phase Plan

### Phase 0: Freeze the security boundary

Do not add new account, inventory, or item features until auth and save storage are moved.

Acceptance:

- no new gameplay feature depends on client-only account state
- no new feature writes important data to `localStorage`

### Phase 1: Replace client auth

Implement server routes:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/session`

Rules:

- store password hashes on the server
- issue a session token or cookie only after login
- remove `localStorage` user database from `public/index.html`

Acceptance:

- a user cannot log in with name only
- page reload preserves login only through server session state
- raw passwords are not stored in browser storage

### Phase 2: Gate socket access

Socket connection must be tied to the authenticated session.

Rules:

- socket handshake validates session
- unauthenticated socket cannot call `join`, `attack`, `equipItem`, `craftItems`, or chat
- user identity comes from server session, not client-submitted name

Acceptance:

- editing the frontend cannot impersonate another account
- opening DevTools and calling `socket.emit("join", { name: "other" })` does not work

### Phase 3: Move persistent storage to a database

Replace `data/profiles.json` with a database.

Recommended tables:

- `users`
- `player_profiles`
- `player_items`
- `player_equipment`
- `sessions`

Minimum stored fields:

- user id
- username
- password hash
- player level, xp, hp, stat points, map id
- item ownership records

Acceptance:

- player progress survives restart and deploy
- save storage does not depend on local container filesystem

### Phase 4: Harden game action validation

Keep all game rewards server-authoritative.

Rules:

- server calculates loot drops and item generation
- server validates item ownership before equip, unequip, and craft
- server validates stat allocation and inventory capacity
- server never trusts client-supplied item stats, rarity, or quantity

Acceptance:

- client packet editing cannot mint items
- client packet editing cannot equip items it does not own
- client packet editing cannot bypass craft requirements

### Phase 5: Abuse prevention and observability

Add:

- origin restrictions for Socket.IO and HTTP
- auth rate limits
- chat rate limits
- suspicious event logging
- admin-safe error logging

Acceptance:

- repeated login spam is throttled
- repeated chat spam is throttled
- failed auth attempts and suspicious socket actions are visible in logs

## Recommended Implementation Order

1. Add server auth routes and server-side user store.
2. Change frontend auth UI to call the server instead of `localStorage`.
3. Add authenticated session check on page load.
4. Add socket auth middleware.
5. Remove `join({ name })` trust model.
6. Move save data to database.
7. Tighten origin and rate limits.

## Review Checklist

Before each phase ships, verify:

- no new sensitive data is stored in browser `localStorage`
- no server API trusts a username without session verification
- all item-affecting actions verify ownership server-side
- all reward generation stays on the server
- all auth failures return safe errors
- reconnect flow cannot steal another player's session

## Test Checklist

### Auth

- register a new account
- log in with correct password
- reject wrong password
- reject duplicate username
- refresh the page and confirm session restore works
- log out and confirm session is cleared

### Socket

- connect without login and confirm gameplay socket is rejected
- try forged `join` payload from DevTools and confirm rejection
- open two browsers on the same account and confirm the intended session policy works

### Inventory and rewards

- attack normal flow works
- equip valid owned item works
- equip nonexistent item fails
- unequip into full inventory fails
- craft with mismatched items fails
- craft with forged item id fails

### Persistence

- restart the server and confirm progress remains
- deploy a new build and confirm progress remains

