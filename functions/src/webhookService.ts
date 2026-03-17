import { getFirestore } from 'firebase-admin/firestore';
import * as crypto from 'crypto';
import axios from 'axios';

export type WebhookEvent =
    | 'rankings.updated'
    | 'schedule.updated'
    | 'field.updated'
    | 'teeTimes.updated'
    | 'results.updated'
    | 'scorecards.updated'
    | 'activeTournament.updated'
    | 'results.cleared';

export interface WebhookPayload {
    event: WebhookEvent;
    timestamp: string;
    tournId?: string;
    year?: number;
    round?: number;
    details?: Record<string, unknown>;
}

export interface WebhookRegistration {
    consumerId: string;
    url: string;
    secret: string;
    events: WebhookEvent[];
    enabled: boolean;
}

const generateSignature = (secret: string, body: string): string => {
    return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
};

/**
 * Fires a webhook event to all registered consumers that subscribe to it.
 * Retries once on failure. Logs delivery status to SyncLogs.
 */
export const fireEvent = async (event: WebhookEvent, payload: Omit<WebhookPayload, 'event' | 'timestamp'>): Promise<void> => {
    const db = getFirestore();

    let registrations: WebhookRegistration[] = [];
    try {
        const snap = await db.collection('Webhook-Registrations').where('enabled', '==', true).get();
        registrations = snap.docs.map(d => d.data() as WebhookRegistration);
    } catch (err) {
        console.error('[webhookService] Failed to read Webhook-Registrations:', err);
        return;
    }

    const subscribers = registrations.filter(r => r.events.includes(event));
    if (subscribers.length === 0) return;

    const fullPayload: WebhookPayload = {
        event,
        timestamp: new Date().toISOString(),
        ...payload,
    };
    const body = JSON.stringify(fullPayload);

    for (const reg of subscribers) {
        const signature = generateSignature(reg.secret, body);
        let delivered = false;
        let lastError = '';

        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                await axios.post(reg.url, body, {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Golf-Core-Signature': signature,
                        'X-Golf-Core-Event': event,
                    },
                    timeout: 10000,
                });
                delivered = true;
                break;
            } catch (err: any) {
                lastError = err?.message || 'Unknown error';
                console.warn(`[webhookService] Attempt ${attempt} failed for ${reg.consumerId} (${event}): ${lastError}`);
                if (attempt < 2) await new Promise(r => setTimeout(r, 1000));
            }
        }

        try {
            await db.collection('SyncLogs').add({
                timestamp: new Date(),
                type: 'webhook',
                status: delivered ? 'success' : 'error',
                message: delivered
                    ? `Webhook '${event}' delivered to ${reg.consumerId}`
                    : `Webhook '${event}' failed for ${reg.consumerId}: ${lastError}`,
                details: { event, consumerId: reg.consumerId, url: reg.url, delivered, error: lastError || null },
            });
        } catch (_) {
            // Non-critical — don't let log failure block the sync
        }
    }
};
