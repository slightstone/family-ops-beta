export const MAX_HOSTED_QUEUE=1000,MAX_HOSTED_RAW_BYTES=8*1024*1024;
export const hostedQueueCount=(binding:string)=>`((SELECT COUNT(*) FROM kids_hosted_events q WHERE q.binding_id=${binding} AND q.consumed_at IS NULL)+(SELECT COUNT(*) FROM kids_hosted_history_messages q WHERE q.binding_id=${binding} AND q.consumed_at IS NULL))`;
export const hostedQueueBytes=(binding:string)=>`(COALESCE((SELECT SUM(raw_bytes) FROM kids_hosted_events q WHERE q.binding_id=${binding}),0)+COALESCE((SELECT SUM(raw_bytes) FROM kids_hosted_history_messages q WHERE q.binding_id=${binding}),0))`;
