import { Inngest, EventSchemas } from "inngest";

/**
 * Typed event catalog. These are the "something happened" facts the pipeline
 * reacts to — the two front doors (a single API call or a CSV batch) both end up
 * emitting `shipment/received`, so there is one pipeline regardless of entry.
 */
type Events = {
  "shipment/received": { data: { shipmentId: string } };
  "batch/created": { data: { batchId: string; shipmentIds: string[] } };
  "review/completed": {
    data: { shipmentId: string; reviewer: string; chosenHsCode: string; pickedFromCandidates: string; note?: string };
  };
  /** Manual trigger for the tariff-rules sync (the cron fires it nightly anyway). */
  "rules/sync.requested": { data: { chapters?: string[] } };
};

export const inngest = new Inngest({
  id: "swip-customs-pipeline",
  schemas: new EventSchemas().fromRecord<Events>(),
});
