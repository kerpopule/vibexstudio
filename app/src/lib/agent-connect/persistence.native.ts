import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import type { AgentCredentialStore, AgentMetadataStore } from '@/lib/agent-connect/core';

const METADATA_KEY = 'vibex.agent-connect.metadata.v1';
const CREDENTIAL_PREFIX = 'vibex.agent-connect.credential.';

function credentialKey(agentId: string): string {
  return `${CREDENTIAL_PREFIX}${agentId.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

/** Non-secret pairing metadata only. Bearer credentials never enter this store. */
export const agentMetadataStore: AgentMetadataStore = {
  load: () => AsyncStorage.getItem(METADATA_KEY),
  save: (value) => AsyncStorage.setItem(METADATA_KEY, value),
};

/** Device keychain/keystore backed credential storage. */
export const agentCredentialStore: AgentCredentialStore = {
  get: (agentId) => SecureStore.getItemAsync(credentialKey(agentId)),
  set: (agentId, value) => SecureStore.setItemAsync(credentialKey(agentId), value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  }),
  remove: (agentId) => SecureStore.deleteItemAsync(credentialKey(agentId)),
};
