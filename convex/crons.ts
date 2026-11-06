import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("mark overdue loans", { minutes: 15 }, internal.scheduled.markOverdueLoans, {});
crons.interval("expire stale requests", { minutes: 15 }, internal.scheduled.expireStaleRequests, {});
crons.interval("cancel missed pickups", { hours: 1 }, internal.scheduled.cancelMissedPickups, {});
crons.daily("housekeeping", { hourUTC: 3, minuteUTC: 15 }, internal.scheduled.housekeeping, {});

export default crons;
