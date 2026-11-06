export function needsAutomaticRoomDetection(data,canManage,attempted){return !!(data?.scan?.key&&canManage&&!data.scan.roomDetectionDone&&!attempted.has(data.scan.key))}
