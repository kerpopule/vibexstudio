/**
 * Local notifications for background builds. When the user leaves the app
 * (or is in a different project) while a turn streams, completion, failure,
 * and needs-your-input moments surface as a local notification that deep
 * links back to the project. No push, no server — CLAUDE.md's no-backend
 * rule holds; everything is scheduled on-device.
 */
import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';

import type { ProjectMeta } from '@/lib/types';

// In-app, alerts stay quiet — haptics and the project badges cover it.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

let permission: 'unknown' | 'granted' | 'denied' = 'unknown';

/**
 * Ask for notification permission while the user is actively engaged (call
 * at turn start — requesting from the background silently fails). Safe to
 * call repeatedly; only the first call can prompt.
 */
export async function primeNotifications(): Promise<void> {
  if (permission !== 'unknown') return;
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) {
      permission = 'granted';
      return;
    }
    if (!current.canAskAgain) {
      permission = 'denied';
      return;
    }
    const asked = await Notifications.requestPermissionsAsync();
    permission = asked.granted ? 'granted' : 'denied';
  } catch {
    permission = 'denied';
  }
}

export type ProjectEvent = 'done' | 'reply' | 'error' | 'paused';

const EVENT_BODY: Record<ProjectEvent, string> = {
  done: 'Build finished — your app is ready to preview.',
  reply: 'VibeX replied and is waiting on you.',
  error: 'The build hit a snag — tap to take a look.',
  paused: 'The build paused in the background — reopen to continue.',
};

/**
 * Notify about a finished/failed/waiting turn — but only when the user isn't
 * looking at the app (backgrounded or inactive). Tapping opens the project
 * (see the response listener in the root layout).
 */
export async function notifyProjectEvent(project: ProjectMeta, event: ProjectEvent): Promise<void> {
  if (AppState.currentState === 'active') return;
  if (permission !== 'granted') return;
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${project.emoji} ${project.name}`,
        body: EVENT_BODY[event],
        data: { projectId: project.id },
        ...(Platform.OS === 'android' ? { color: '#5EC2FF' } : {}),
      },
      trigger: null,
    });
  } catch {
    // Notifications are best-effort; never let them break a turn.
  }
}

/** The projectId a tapped notification points at, or null. */
export function projectIdFromResponse(response: Notifications.NotificationResponse): string | null {
  const id = response.notification.request.content.data?.projectId;
  return typeof id === 'string' ? id : null;
}
