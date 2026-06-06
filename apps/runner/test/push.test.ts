import { describe, expect, it, vi } from "vitest"

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(),
  },
}))

import webpush from "web-push"
import {
  maybeSendPushForCompletedRun,
  type PushDbApi,
  sendPushForRun,
  type VapidConfig,
} from "../src/push"

const VAPID: VapidConfig = {
  publicKey: "publicKeyBase64",
  privateKey: "privateKeyBase64",
  subject: "mailto:test@example.com",
}

const sendNotificationMock = webpush.sendNotification as ReturnType<typeof vi.fn>

function makeDb(overrides: Partial<PushDbApi> = {}): {
  listSpy: ReturnType<typeof vi.fn>
  deleteSpy: ReturnType<typeof vi.fn>
  api: PushDbApi
} {
  const listSpy = vi.fn(async () => [])
  const deleteSpy = vi.fn(async () => {})
  const api: PushDbApi = {
    listSubscriptionsForOwner: overrides.listSubscriptionsForOwner ?? listSpy,
    deleteSubscriptionByEndpoint: overrides.deleteSubscriptionByEndpoint ?? deleteSpy,
  }
  return { listSpy, deleteSpy, api }
}

describe("sendPushForRun", () => {
  it("returns zero counts when subscription list is empty", async () => {
    sendNotificationMock.mockReset()
    const { api } = makeDb()
    const result = await sendPushForRun({
      vapid: VAPID,
      db: api,
      ownerId: "owner-1",
      runId: "run-1",
      requestedUrl: "https://example.com",
    })
    expect(result).toEqual({ sent: 0, deleted: 0, failed: 0 })
    expect(sendNotificationMock).not.toHaveBeenCalled()
  })

  it("sends one push per subscription and returns sent count", async () => {
    sendNotificationMock.mockReset()
    sendNotificationMock.mockResolvedValue(undefined)
    const { api } = makeDb({
      listSubscriptionsForOwner: vi.fn(async () => [
        { endpoint: "https://push.example.com/a", p256dh: "p1", auth: "a1" },
        { endpoint: "https://push.example.com/b", p256dh: "p2", auth: "a2" },
      ]),
    })
    const result = await sendPushForRun({
      vapid: VAPID,
      db: api,
      ownerId: "owner-1",
      runId: "run-1",
      requestedUrl: "https://example.com",
    })
    expect(result).toEqual({ sent: 2, deleted: 0, failed: 0 })
    expect(sendNotificationMock).toHaveBeenCalledTimes(2)
  })

  it("on 410: deletes the subscription and counts deleted", async () => {
    sendNotificationMock.mockReset()
    sendNotificationMock.mockRejectedValue(Object.assign(new Error("gone"), { statusCode: 410 }))
    const { deleteSpy, api } = makeDb({
      listSubscriptionsForOwner: vi.fn(async () => [
        { endpoint: "https://push.example.com/stale", p256dh: "p", auth: "a" },
      ]),
    })
    const result = await sendPushForRun({
      vapid: VAPID,
      db: api,
      ownerId: "owner-1",
      runId: "run-1",
      requestedUrl: "https://example.com",
    })
    expect(result).toEqual({ sent: 0, deleted: 1, failed: 0 })
    expect(deleteSpy).toHaveBeenCalledWith("https://push.example.com/stale")
  })

  it("on 500: keeps the subscription and counts failed", async () => {
    sendNotificationMock.mockReset()
    sendNotificationMock.mockRejectedValue(Object.assign(new Error("boom"), { statusCode: 500 }))
    const { deleteSpy, api } = makeDb({
      listSubscriptionsForOwner: vi.fn(async () => [
        { endpoint: "https://push.example.com/transient", p256dh: "p", auth: "a" },
      ]),
    })
    const result = await sendPushForRun({
      vapid: VAPID,
      db: api,
      ownerId: "owner-1",
      runId: "run-1",
      requestedUrl: "https://example.com",
    })
    expect(result).toEqual({ sent: 0, deleted: 0, failed: 1 })
    expect(deleteSpy).not.toHaveBeenCalled()
  })
})

describe("maybeSendPushForCompletedRun", () => {
  it("skips push delivery when run status is not 'completed'", async () => {
    sendNotificationMock.mockReset()
    const { listSpy, api } = makeDb()
    const result = await maybeSendPushForCompletedRun({
      runStatus: "partial",
      vapid: VAPID,
      db: api,
      ownerId: "owner-1",
      runId: "run-1",
      requestedUrl: "https://example.com",
    })
    expect(result).toBeNull()
    expect(listSpy).not.toHaveBeenCalled()
    expect(sendNotificationMock).not.toHaveBeenCalled()
  })
})
