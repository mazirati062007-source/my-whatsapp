/**
 * Security Rules Verification Suite — Dirty Dozen Adversarial Payloads
 * Run against Firebase Local Emulator using @firebase/rules-unit-testing.
 */
import { readFileSync } from 'node:fs';
import {
  assertFails,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';

export async function verifyDirtyDozenRules() {
  const testEnv: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'demo-whatsapp-security-audit',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });

  try {
    const userA = testEnv.authenticatedContext('user_A', {
      email: 'usera@example.com',
      email_verified: true,
    });
    const userB = testEnv.authenticatedContext('user_B', {
      email: 'userb@example.com',
      email_verified: true,
    });
    const userC = testEnv.authenticatedContext('user_C', {
      email: 'userc@example.com',
      email_verified: true,
    });
    const unverifiedUserA = testEnv.authenticatedContext('user_A', {
      email: 'usera@example.com',
      email_verified: false,
    });

    // Seed valid profiles in security-disabled setup
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const now = Timestamp.now();
      await setDoc(doc(db, 'publicProfiles', 'user_A'), {
        uid: 'user_A',
        displayName: 'User A',
        searchName: 'user a',
        photoURL: '',
        about: 'Online',
        onlineStatus: 'в сети',
        visibility: 'discoverable',
        createdAt: now,
        updatedAt: now,
      });
      await setDoc(doc(db, 'publicProfiles', 'user_B'), {
        uid: 'user_B',
        displayName: 'User B',
        searchName: 'user b',
        photoURL: '',
        about: 'Online',
        onlineStatus: 'в сети',
        visibility: 'discoverable',
        createdAt: now,
        updatedAt: now,
      });
      await setDoc(doc(db, 'userPrivate', 'user_A'), {
        uid: 'user_A',
        email: 'usera@example.com',
        createdAt: now,
        updatedAt: now,
      });
      await setDoc(doc(db, 'conversations', 'dm_user_A_user_B'), {
        id: 'dm_user_A_user_B',
        participantOneId: 'user_A',
        participantTwoId: 'user_B',
        participantOneName: 'User A',
        participantOnePhoto: '',
        participantTwoName: 'User B',
        participantTwoPhoto: '',
        lastMessagePreview: 'Hi',
        lastMessageTimeMs: 1000,
        activeCallType: 'none',
        activeCallStatus: 'idle',
        activeCallInitiatorId: '',
        createdAt: now,
        updatedAt: now,
      });
      await setDoc(doc(db, 'conversations/dm_user_A_user_B/messages', 'msg_read_1'), {
        id: 'msg_read_1',
        conversationId: 'dm_user_A_user_B',
        participantOneId: 'user_A',
        participantTwoId: 'user_B',
        senderId: 'user_A',
        senderName: 'User A',
        type: 'text',
        text: 'Hello',
        timestampMs: 1000,
        status: 'read',
        mediaId: '',
        mediaMimeType: '',
        previewDataUrl: '',
        compressedSize: 0,
        originalSize: 0,
        mediaDuration: 0,
        callType: 'none',
        callDurationSec: 0,
        replyToSender: '',
        replyToPreview: '',
        createdAt: now,
        updatedAt: now,
      });
    });

    // 1. Identity Spoofing on PublicProfile
    await assertFails(
      setDoc(doc(userA.firestore(), 'publicProfiles', 'user_C'), {
        uid: 'user_C',
        displayName: 'Spoofed',
        searchName: 'spoofed',
        photoURL: '',
        about: '',
        onlineStatus: 'в сети',
        visibility: 'discoverable',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // 2. Unverified Email Write
    await assertFails(
      updateDoc(doc(unverifiedUserA.firestore(), 'publicProfiles', 'user_A'), {
        about: 'Unverified edit',
        updatedAt: serverTimestamp(),
      })
    );

    // 3. PII Cross-User Scrape
    await assertFails(getDoc(doc(userB.firestore(), 'userPrivate', 'user_A')));
    await assertFails(getDocs(collection(userB.firestore(), 'userPrivate')));

    // 4. Shadow Field Injection
    await assertFails(
      updateDoc(doc(userA.firestore(), 'publicProfiles', 'user_A'), {
        about: 'Valid bio',
        isAdmin: true,
        updatedAt: serverTimestamp(),
      })
    );

    // 5. Resource / ID Poisoning (>128 chars)
    const longId = 'x'.repeat(200);
    await assertFails(
      setDoc(doc(userA.firestore(), 'conversations', longId), {
        id: longId,
      })
    );

    // 6. Denial-of-Wallet Oversized String
    await assertFails(
      setDoc(doc(userA.firestore(), 'conversations/dm_user_A_user_B/messages', 'msg_huge'), {
        id: 'msg_huge',
        conversationId: 'dm_user_A_user_B',
        participantOneId: 'user_A',
        participantTwoId: 'user_B',
        senderId: 'user_A',
        senderName: 'User A',
        type: 'text',
        text: 'A'.repeat(10000),
        timestampMs: Date.now(),
        status: 'sent',
        mediaId: '',
        mediaMimeType: '',
        previewDataUrl: '',
        compressedSize: 0,
        originalSize: 0,
        mediaDuration: 0,
        callType: 'none',
        callDurationSec: 0,
        replyToSender: '',
        replyToPreview: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // 7. Orphan Conversation Creation (non-existent participantTwoId)
    await assertFails(
      setDoc(doc(userA.firestore(), 'conversations', 'dm_user_A_ghost'), {
        id: 'dm_user_A_ghost',
        participantOneId: 'user_A',
        participantTwoId: 'ghost_999',
        participantOneName: 'User A',
        participantOnePhoto: '',
        participantTwoName: 'Ghost',
        participantTwoPhoto: '',
        lastMessagePreview: '',
        lastMessageTimeMs: 1000,
        activeCallType: 'none',
        activeCallStatus: 'idle',
        activeCallInitiatorId: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // 8. Non-Participant Conversation Hijack
    await assertFails(getDoc(doc(userC.firestore(), 'conversations', 'dm_user_A_user_B')));

    // 9. Message Participant Desync Poisoning
    await assertFails(
      setDoc(doc(userA.firestore(), 'conversations/dm_user_A_user_B/messages', 'msg_leak'), {
        id: 'msg_leak',
        conversationId: 'dm_user_A_user_B',
        participantOneId: 'user_A',
        participantTwoId: 'user_C',
        senderId: 'user_A',
        senderName: 'User A',
        type: 'text',
        text: 'Secret',
        timestampMs: Date.now(),
        status: 'sent',
        mediaId: '',
        mediaMimeType: '',
        previewDataUrl: '',
        compressedSize: 0,
        originalSize: 0,
        mediaDuration: 0,
        callType: 'none',
        callDurationSec: 0,
        replyToSender: '',
        replyToPreview: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // 10. Forged Client Timestamp
    await assertFails(
      setDoc(doc(userA.firestore(), 'conversations/dm_user_A_user_B/messages', 'msg_forged_ts'), {
        id: 'msg_forged_ts',
        conversationId: 'dm_user_A_user_B',
        participantOneId: 'user_A',
        participantTwoId: 'user_B',
        senderId: 'user_A',
        senderName: 'User A',
        type: 'text',
        text: 'Past',
        timestampMs: Date.now(),
        status: 'sent',
        mediaId: '',
        mediaMimeType: '',
        previewDataUrl: '',
        compressedSize: 0,
        originalSize: 0,
        mediaDuration: 0,
        callType: 'none',
        callDurationSec: 0,
        replyToSender: '',
        replyToPreview: '',
        createdAt: Timestamp.fromMillis(946684800000),
        updatedAt: Timestamp.fromMillis(946684800000),
      })
    );

    // 11. Immutable Field Mutation
    await assertFails(
      updateDoc(doc(userA.firestore(), 'conversations', 'dm_user_A_user_B'), {
        participantTwoId: 'user_C',
        updatedAt: serverTimestamp(),
      })
    );

    // 12. Terminal State Reversal (read -> sent)
    await assertFails(
      updateDoc(doc(userB.firestore(), 'conversations/dm_user_A_user_B/messages', 'msg_read_1'), {
        status: 'sent',
        updatedAt: serverTimestamp(),
      })
    );
  } finally {
    await testEnv.cleanup();
  }
}
