# Security Specification — WhatsApp Web Messenger (Zero-Trust ABAC)

## 1. Data Invariants

1. **Global Catch-All Deny**: Every path not explicitly matched is denied (`allow read, write: if false;`).
2. **Verified Identity Mandate**: All write operations require `request.auth != null && request.auth.token.email_verified == true`.
3. **PII Split-Collection Isolation**: User email addresses reside exclusively in `/userPrivate/{userId}` and can ONLY be read (`get`), created, or updated by `request.auth.uid == userId` (`allow list: if false;`). `/publicProfiles/{userId}` contains zero PII.
4. **Scoped Discovery List**: Listing `/publicProfiles` requires `isSignedIn()`, `resource.data.visibility == 'discoverable'`, and `request.query.limit <= 50`. Profiles marked `hidden` cannot be listed.
5. **Relational Conversation Integrity**: Creating `/conversations/{conversationId}` requires the caller to be `participantOneId` or `participantTwoId`, both participants must differ (`participantOneId != participantTwoId`), and both `/publicProfiles/{participantOneId}` and `/publicProfiles/{participantTwoId}` must exist.
6. **Master Gate & Zero-Get List Sync on Messages**: Every single-document operation (`get`, `create`, `update`, `delete`) on `/conversations/{conversationId}/messages/{messageId}` fetches `/conversations/{conversationId}` via `get()` to verify live participant membership and exact `participantOneId`/`participantTwoId` parity. `allow list` checks `resource.data.participantOneId == request.auth.uid || resource.data.participantTwoId == request.auth.uid` with zero `get()` calls.
7. **Temporal & Immutable Integrity**: `createdAt == request.time` on creation; `createdAt`, `uid`, `participantOneId`, `participantTwoId`, `conversationId`, and `senderId` are strictly immutable on update; `updatedAt == request.time` on every update.
8. **Terminal State Locking**: Once a `ChatMessage` reaches `status == 'read'`, no further status updates are permitted.

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Identity Spoofing on PublicProfile**: Authenticated `user_A` attempts `create` on `/publicProfiles/user_B` with `uid: "user_B"`. -> `PERMISSION_DENIED`.
2. **Unverified Email Write**: Authenticated `user_A` with `email_verified: false` attempts `create` on `/publicProfiles/user_A`. -> `PERMISSION_DENIED`.
3. **PII Cross-User Scrape**: Authenticated `user_B` attempts `get` or `list` on `/userPrivate/user_A` to steal `user_A`'s email. -> `PERMISSION_DENIED`.
4. **Shadow Field Injection**: `user_A` updates `/publicProfiles/user_A` adding `"isAdmin": true` alongside valid fields. -> `PERMISSION_DENIED` (`hasOnly` rejection).
5. **Resource / ID Poisoning**: `user_A` attempts `create` on `/conversations/bad$id!with/slashes` or a 500-char ID. -> `PERMISSION_DENIED` (`isValidId` regex/length rejection).
6. **Denial-of-Wallet Oversized String**: `user_A` sends a `ChatMessage` with a 25,000-character `text` string (`maxLength` is 4000). -> `PERMISSION_DENIED`.
7. **Orphan Conversation Creation**: `user_A` attempts to create a conversation with `participantTwoId: "non_existent_ghost_uid"`. -> `PERMISSION_DENIED` (`exists()` check on `/publicProfiles` fails).
8. **Non-Participant Conversation Hijack**: `user_C` attempts `create` or `get` on `/conversations/dm_userA_userB` where participants are `user_A` and `user_B`. -> `PERMISSION_DENIED`.
9. **Message Participant Desync Poisoning**: `user_A` creates a message inside `/conversations/dm_userA_userB` setting `participantTwoId: "user_C"` to leak messages to `user_C`. -> `PERMISSION_DENIED` (Master Gate parent parity check fails).
10. **Forged Client Timestamp**: `user_A` creates a message with `createdAt` set to year 2020 instead of `serverTimestamp()` (`request.time`). -> `PERMISSION_DENIED`.
11. **Immutable Field Mutation**: `user_A` updates `/conversations/dm_userA_userB` trying to swap `participantTwoId` to `user_C`. -> `PERMISSION_DENIED`.
12. **Terminal State Reversal**: `user_B` attempts to update a `ChatMessage` whose `status` is already `'read'` back to `'sent'`. -> `PERMISSION_DENIED`.
