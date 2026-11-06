/**
 * DEVELOPMENT SEED DATA — clearly marked with `isSeed: true` and shown with a
 * "Sample" label in the UI. Seed accounts cannot sign in and never receive
 * email. Reputation on seed profiles comes only from the sample loans created
 * here; it is not real user activity.
 *
 *   npx convex env set SEED_ENABLED true
 *   npx convex run seed:run       # create sample neighbourhood
 *   npx convex run seed:reset     # remove all seed data
 */
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { SEED_NEIGHBORHOOD, TIME, type FeedbackTag, type ToolCategory, type ToolCondition } from "./lib/constants";
import { approximateLocation } from "./lib/geo";
import { EMPTY_STATS } from "./lib/rules";
import { bumpStats } from "./lib/stats";
import { buildSearchText, recomputeToolStatus } from "./lib/toolStatus";

function assertSeedEnabled() {
  if (process.env.SEED_ENABLED !== "true") {
    throw new Error("Seeding is disabled. Set SEED_ENABLED=true on a development deployment.");
  }
}

/** Deterministic PRNG so seeded coordinates are stable between runs. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PEOPLE = [
  { key: "arun", name: "Arun Kumar", area: "Indiranagar", bio: "Weekend woodworker. Happy to show you how the tools work.", trusted: true, ageDays: 420 },
  { key: "priya", name: "Priya Nair", area: "HAL 2nd Stage", bio: "Gardener and occasional camper.", trusted: true, ageDays: 300 },
  { key: "rahul", name: "Rahul Mehta", area: "Domlur", bio: "Home cook with too many kitchen gadgets.", trusted: false, ageDays: 150 },
  { key: "sneha", name: "Sneha Iyer", area: "Jeevan Bima Nagar", bio: "I fix bikes and cars on Sundays.", trusted: false, ageDays: 95 },
  { key: "vikram", name: "Vikram Rao", area: "Ulsoor", bio: "Renovating an old flat, one room at a time.", trusted: true, ageDays: 510 },
  { key: "ananya", name: "Ananya Desai", area: "CV Raman Nagar", bio: "Badminton most evenings.", trusted: false, ageDays: 40 },
  { key: "karthik", name: "Karthik Reddy", area: "Kodihalli", bio: "New to the neighbourhood.", trusted: false, ageDays: 60 },
  { key: "meera", name: "Meera Joseph", area: "New Thippasandra", bio: "Borrow more, buy less.", trusted: false, ageDays: 210 },
] as const;
type PersonKey = (typeof PEOPLE)[number]["key"];

interface SeedTool {
  key: string;
  owner: PersonKey;
  name: string;
  category: ToolCategory;
  condition: ToolCondition;
  description: string;
  area: string;
  lat: number;
  lng: number;
  maxLoanDays: number;
  instructions?: string;
  terms?: string;
  deposit?: number;
  listed?: boolean;
}

const TOOLS: SeedTool[] = [
  { key: "drill", owner: "arun", name: "Cordless Drill (18V)", category: "POWER_TOOLS", condition: "GOOD", description: "18V cordless drill/driver with two lithium batteries, a charger and a 30-piece bit set.", area: "Indiranagar, Bengaluru", lat: 12.97161, lng: 77.64125, maxLoanDays: 4, instructions: "Charge both batteries before returning, please.", deposit: 1000 },
  { key: "grinder", owner: "arun", name: "Angle Grinder", category: "POWER_TOOLS", condition: "FAIR", description: "4-inch angle grinder with a cutting disc and a grinding disc. Safety goggles included.", area: "Indiranagar, Bengaluru", lat: 12.97212, lng: 77.64301, maxLoanDays: 2, terms: "Bring your own discs for heavy jobs." },
  { key: "saw", owner: "vikram", name: "Circular Saw", category: "POWER_TOOLS", condition: "LIKE_NEW", description: "7¼-inch circular saw, laser guide, fresh 24T blade. Great for plywood and decking.", area: "Ulsoor, Bengaluru", lat: 12.98151, lng: 77.62066, maxLoanDays: 3, deposit: 2000 },
  { key: "washer", owner: "priya", name: "Pressure Washer", category: "CLEANING_EQUIPMENT", condition: "LIKE_NEW", description: "Electric pressure washer with a lance, foam nozzle and patio cleaner attachment. Ideal for balconies and cars.", area: "HAL 2nd Stage, Bengaluru", lat: 12.96338, lng: 77.64702, maxLoanDays: 2 },
  { key: "vacuum", owner: "rahul", name: "Wet & Dry Vacuum", category: "CLEANING_EQUIPMENT", condition: "GOOD", description: "20L wet and dry vacuum with blower function. Handles post-renovation dust well.", area: "Domlur, Bengaluru", lat: 12.96102, lng: 77.63873, maxLoanDays: 3 },
  { key: "mower", owner: "priya", name: "Electric Lawn Mower", category: "GARDEN_TOOLS", condition: "GOOD", description: "32cm corded lawn mower with grass box. Extension cable included.", area: "HAL 2nd Stage, Bengaluru", lat: 12.96421, lng: 77.64588, maxLoanDays: 2, instructions: "Empty the grass box before returning." },
  { key: "trimmer", owner: "sneha", name: "Hedge Trimmer", category: "GARDEN_TOOLS", condition: "FAIR", description: "Electric hedge trimmer, 50cm blade. Blade guard included.", area: "Jeevan Bima Nagar, Bengaluru", lat: 12.96688, lng: 77.65529, maxLoanDays: 2 },
  { key: "shears", owner: "priya", name: "Pruning Shears Set", category: "GARDEN_TOOLS", condition: "BRAND_NEW", description: "Bypass pruners, loppers and a folding saw. Sharpened last month.", area: "HAL 2nd Stage, Bengaluru", lat: 12.96255, lng: 77.64811, maxLoanDays: 7 },
  { key: "tent", owner: "vikram", name: "4-Person Tent", category: "CAMPING_EQUIPMENT", condition: "GOOD", description: "Spacious 4-person dome tent with rain fly and footprint. Pitches in about 10 minutes.", area: "Ulsoor, Bengaluru", lat: 12.98012, lng: 77.62201, maxLoanDays: 7, instructions: "Please dry it fully before packing it back.", deposit: 1500 },
  { key: "stove", owner: "ananya", name: "Camping Stove", category: "CAMPING_EQUIPMENT", condition: "LIKE_NEW", description: "Compact butane stove with carry case. Gas canisters not included.", area: "CV Raman Nagar, Bengaluru", lat: 12.98552, lng: 77.66338, maxLoanDays: 5 },
  { key: "mixer", owner: "rahul", name: "Stand Mixer", category: "KITCHEN_EQUIPMENT", condition: "LIKE_NEW", description: "4.8L stand mixer with whisk, dough hook and paddle. Perfect for festival baking.", area: "Domlur, Bengaluru", lat: 12.96011, lng: 77.63702, maxLoanDays: 3 },
  { key: "pasta", owner: "rahul", name: "Pasta Maker", category: "KITCHEN_EQUIPMENT", condition: "GOOD", description: "Manual pasta roller with fettuccine and spaghetti cutters.", area: "Domlur, Bengaluru", lat: 12.96152, lng: 77.63955, maxLoanDays: 4 },
  { key: "jack", owner: "sneha", name: "Car Jack & Axle Stands", category: "AUTOMOTIVE_TOOLS", condition: "GOOD", description: "2-tonne trolley jack with a pair of axle stands. Wheel chocks included.", area: "Jeevan Bima Nagar, Bengaluru", lat: 12.96751, lng: 77.65408, maxLoanDays: 2, terms: "Only on flat, solid ground please." },
  { key: "starter", owner: "sneha", name: "Jump Starter", category: "AUTOMOTIVE_TOOLS", condition: "LIKE_NEW", description: "Portable 1000A jump starter with USB power bank. Fully charged.", area: "Jeevan Bima Nagar, Bengaluru", lat: 12.96602, lng: 77.65633, maxLoanDays: 3 },
  { key: "projector", owner: "ananya", name: "HD Projector", category: "ELECTRONICS", condition: "GOOD", description: "1080p projector with HDMI cable and a 100-inch pull-down screen.", area: "CV Raman Nagar, Bengaluru", lat: 12.98481, lng: 77.66452, maxLoanDays: 3, deposit: 3000 },
  { key: "ladder", owner: "vikram", name: "Extension Ladder (6m)", category: "CONSTRUCTION_TOOLS", condition: "FAIR", description: "Aluminium extension ladder, extends to 6 metres. Needs a car or auto to transport.", area: "Ulsoor, Bengaluru", lat: 12.98236, lng: 77.61952, maxLoanDays: 3 },
  { key: "tilecutter", owner: "vikram", name: "Tile Cutter", category: "CONSTRUCTION_TOOLS", condition: "HEAVILY_USED", description: "Manual 600mm tile cutter. Works well; the scoring wheel was replaced recently.", area: "Ulsoor, Bengaluru", lat: 12.98088, lng: 77.62115, maxLoanDays: 5, listed: false },
  { key: "badminton", owner: "ananya", name: "Badminton Set", category: "SPORTS_EQUIPMENT", condition: "GOOD", description: "Four rackets, net with poles and a tube of feather shuttles.", area: "CV Raman Nagar, Bengaluru", lat: 12.98633, lng: 77.66202, maxLoanDays: 7 },
  { key: "hammock", owner: "arun", name: "Travel Hammock", category: "OTHER", condition: "LIKE_NEW", description: "Parachute-nylon hammock with tree straps. Packs into a fist-sized pouch.", area: "Indiranagar, Bengaluru", lat: 12.97058, lng: 77.63988, maxLoanDays: 10 },
];

interface SeedHistory {
  tool: string;
  borrower: PersonKey;
  daysAgo: number;
  days: number;
  late?: boolean;
  ratingForOwner: number;
  ratingForBorrower: number;
  ownerTags: FeedbackTag[];
  borrowerTags: FeedbackTag[];
  ownerComment: string;
  borrowerComment: string;
  damage?: string;
}

const HISTORY: SeedHistory[] = [
  { tool: "drill", borrower: "meera", daysAgo: 40, days: 2, ratingForOwner: 5, ratingForBorrower: 5, ownerTags: ["ITEM_AS_DESCRIBED", "EASY_TO_COORDINATE"], borrowerTags: ["RETURNED_ON_TIME", "RETURNED_GOOD_CONDITION"], ownerComment: "Arun showed me how to swap the bits. Super easy pickup.", borrowerComment: "Returned charged and clean." },
  { tool: "tent", borrower: "karthik", daysAgo: 30, days: 4, ratingForOwner: 5, ratingForBorrower: 4, ownerTags: ["ITEM_AS_DESCRIBED", "COMMUNICATED_WELL"], borrowerTags: ["RETURNED_GOOD_CONDITION"], ownerComment: "Great tent, dry and complete.", borrowerComment: "Good condition, slightly damp but fine." },
  { tool: "washer", borrower: "rahul", daysAgo: 25, days: 1, late: true, ratingForOwner: 4, ratingForBorrower: 3, ownerTags: ["EASY_TO_COORDINATE"], borrowerTags: ["RETURNED_LATE", "COMMUNICATED_WELL"], ownerComment: "Worked great on the balcony.", borrowerComment: "Came back a day late but he kept me posted." },
  { tool: "mixer", borrower: "priya", daysAgo: 20, days: 2, ratingForOwner: 5, ratingForBorrower: 5, ownerTags: ["ITEM_AS_DESCRIBED"], borrowerTags: ["RETURNED_ON_TIME", "COMMUNICATED_WELL"], ownerComment: "Spotless mixer. Thanks Rahul!", borrowerComment: "Lovely borrower." },
  { tool: "jack", borrower: "vikram", daysAgo: 15, days: 1, ratingForOwner: 4, ratingForBorrower: 4, ownerTags: ["EASY_TO_COORDINATE"], borrowerTags: ["RETURNED_ON_TIME"], ownerComment: "Solid jack.", borrowerComment: "Quick and easy." },
  { tool: "grinder", borrower: "karthik", daysAgo: 12, days: 1, ratingForOwner: 4, ratingForBorrower: 3, ownerTags: ["COMMUNICATED_WELL"], borrowerTags: ["ITEM_DAMAGED"], ownerComment: "Did the job.", borrowerComment: "Guard came back bent; Karthik acknowledged it.", damage: "The disc guard was bent and one mounting screw is missing." },
  { tool: "projector", borrower: "meera", daysAgo: 8, days: 2, ratingForOwner: 5, ratingForBorrower: 5, ownerTags: ["ITEM_AS_DESCRIBED", "EASY_TO_COORDINATE"], borrowerTags: ["RETURNED_ON_TIME", "RETURNED_GOOD_CONDITION"], ownerComment: "Movie night sorted.", borrowerComment: "Perfect." },
];

async function insertLoan(
  ctx: MutationCtx,
  args: {
    toolId: Id<"tools">;
    toolName: string;
    category: ToolCategory;
    ownerId: Id<"users">;
    borrowerId: Id<"users">;
    pickupAt: number;
    returnBy: number;
    status: "APPROVED" | "COLLECTION_OTP_PENDING" | "ACTIVE_LOAN" | "COMPLETED";
    late?: boolean;
  },
) {
  const now = Date.now();
  const requestId = await ctx.db.insert("borrowRequests", {
    toolId: args.toolId,
    ownerId: args.ownerId,
    borrowerId: args.borrowerId,
    pickupAt: args.pickupAt,
    returnBy: args.returnBy,
    status: "APPROVED",
    decidedAt: args.pickupAt - TIME.day,
    isSeed: true,
    createdAt: args.pickupAt - 2 * TIME.day,
    updatedAt: now,
  });
  const done = args.status === "COMPLETED";
  const loanId = await ctx.db.insert("loans", {
    requestId,
    toolId: args.toolId,
    ownerId: args.ownerId,
    borrowerId: args.borrowerId,
    status: args.status,
    pickupAt: args.pickupAt,
    returnBy: args.returnBy,
    toolName: args.toolName,
    toolCategory: args.category,
    collectedAt: args.status === "ACTIVE_LOAN" || done ? args.pickupAt : undefined,
    returnRequestedAt: done ? args.returnBy + (args.late ? TIME.day : 0) : undefined,
    returnedAt: done ? args.returnBy + (args.late ? TIME.day : 0) : undefined,
    completedAt: done ? args.returnBy + (args.late ? TIME.day : 0) : undefined,
    wasOverdue: args.late === true,
    lateReturn: done ? args.late === true : undefined,
    isSeed: true,
    createdAt: args.pickupAt - TIME.day,
    updatedAt: now,
  });
  await ctx.db.patch(requestId, { loanId });
  return { loanId, requestId };
}

export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    assertSeedEnabled();
    const existing = await ctx.db.query("users").withIndex("by_seed", (q) => q.eq("isSeed", true)).first();
    if (existing) return { skipped: true, reason: "Seed data already exists. Run seed:reset first." };

    const now = Date.now();
    const rand = mulberry32(20261105);
    const people = new Map<PersonKey, Id<"users">>();
    for (const p of PEOPLE) {
      const id = await ctx.db.insert("users", {
        tokenIdentifier: `seed|${p.key}`,
        clerkUserId: `seed_${p.key}`,
        email: `${p.key}@seed.lendloop.invalid`,
        name: p.name,
        phoneVerified: false,
        bio: p.bio,
        areaLabel: p.area,
        locationSharing: false,
        role: "USER",
        status: "ACTIVE",
        trustedLender: p.trusted,
        onboardedAt: now - p.ageDays * TIME.day,
        stats: EMPTY_STATS,
        isSeed: true,
        createdAt: now - p.ageDays * TIME.day,
        updatedAt: now,
      });
      people.set(p.key, id);
    }

    const tools = new Map<string, { id: Id<"tools">; seed: SeedTool }>();
    for (const t of TOOLS) {
      const ownerId = people.get(t.owner)!;
      const approx = approximateLocation({ lat: t.lat, lng: t.lng }, rand);
      const listed = t.listed !== false;
      const createdAt = now - Math.floor(rand() * 60 + 1) * TIME.day;
      const id = await ctx.db.insert("tools", {
        ownerId,
        name: t.name,
        category: t.category,
        description: t.description,
        condition: t.condition,
        imageIds: [],
        pickupArea: t.area,
        approxLat: approx.lat,
        approxLng: approx.lng,
        instructions: t.instructions,
        lendingTerms: t.terms,
        depositAmount: t.deposit,
        maxLoanDays: t.maxLoanDays,
        isListed: listed,
        status: listed ? "AVAILABLE" : "UNAVAILABLE",
        discoverable: listed,
        searchText: buildSearchText({ name: t.name, category: t.category, pickupArea: t.area, description: t.description }),
        isSeed: true,
        createdAt,
        updatedAt: createdAt,
      });
      await ctx.db.insert("toolPickupLocations", {
        toolId: id,
        ownerId,
        lat: t.lat,
        lng: t.lng,
        address: `Sample address near ${t.area.split(",")[0]}`,
        updatedAt: createdAt,
      });
      await bumpStats(ctx, ownerId, { itemsListed: 1 });
      tools.set(t.key, { id, seed: t });
    }

    // Completed history with two-sided feedback.
    for (const h of HISTORY) {
      const tool = tools.get(h.tool)!;
      const ownerId = people.get(tool.seed.owner)!;
      const borrowerId = people.get(h.borrower)!;
      const pickupAt = now - h.daysAgo * TIME.day;
      const returnBy = pickupAt + h.days * TIME.day;
      const { loanId } = await insertLoan(ctx, {
        toolId: tool.id,
        toolName: tool.seed.name,
        category: tool.seed.category,
        ownerId,
        borrowerId,
        pickupAt,
        returnBy,
        status: "COMPLETED",
        late: h.late,
      });
      await bumpStats(ctx, borrowerId, { borrowingTotal: 1, borrowingCompleted: 1, lateReturns: h.late ? 1 : 0 });
      await bumpStats(ctx, ownerId, { lendingTotal: 1, lendingCompleted: 1 });
      const fbAt = returnBy + TIME.day;
      await ctx.db.insert("feedback", {
        loanId, authorId: borrowerId, subjectId: ownerId, direction: "BORROWER_TO_OWNER",
        rating: h.ratingForOwner, comment: h.ownerComment, tags: h.ownerTags, status: "VISIBLE", isSeed: true, createdAt: fbAt,
      });
      await bumpStats(ctx, ownerId, { ratingSum: h.ratingForOwner, ratingCount: 1 });
      await ctx.db.insert("feedback", {
        loanId, authorId: ownerId, subjectId: borrowerId, direction: "OWNER_TO_BORROWER",
        rating: h.ratingForBorrower, comment: h.borrowerComment, tags: h.borrowerTags, status: "VISIBLE", isSeed: true, createdAt: fbAt,
      });
      await bumpStats(ctx, borrowerId, { ratingSum: h.ratingForBorrower, ratingCount: 1 });
      if (h.damage) {
        await ctx.db.insert("damageReports", {
          loanId, toolId: tool.id, reporterId: ownerId, subjectId: borrowerId, description: h.damage, evidenceIds: [],
          status: "ACKNOWLEDGED", borrowerResponse: "Sorry about that — I'll replace the screw.", isSeed: true,
          createdAt: returnBy, updatedAt: returnBy,
        });
        await bumpStats(ctx, borrowerId, { damageReportsReceived: 1, damageReportsVerified: 1 });
      }
    }

    // Current states: one lent, one reserved, one with a pending request.
    const mower = tools.get("mower")!;
    await insertLoan(ctx, {
      toolId: mower.id, toolName: mower.seed.name, category: mower.seed.category,
      ownerId: people.get("priya")!, borrowerId: people.get("arun")!,
      pickupAt: now - TIME.day, returnBy: now + TIME.day, status: "ACTIVE_LOAN",
    });
    await bumpStats(ctx, people.get("arun")!, { borrowingTotal: 1 });
    await bumpStats(ctx, people.get("priya")!, { lendingTotal: 1 });

    const saw = tools.get("saw")!;
    await insertLoan(ctx, {
      toolId: saw.id, toolName: saw.seed.name, category: saw.seed.category,
      ownerId: people.get("vikram")!, borrowerId: people.get("sneha")!,
      pickupAt: now + 3 * TIME.day, returnBy: now + 5 * TIME.day, status: "APPROVED",
    });

    const stove = tools.get("stove")!;
    await ctx.db.insert("borrowRequests", {
      toolId: stove.id, ownerId: people.get("ananya")!, borrowerId: people.get("meera")!,
      pickupAt: now + 4 * TIME.day, returnBy: now + 6 * TIME.day,
      message: "Heading to Nandi Hills this weekend — would love to borrow it!",
      status: "PENDING", isSeed: true, createdAt: now - TIME.hour, updatedAt: now - TIME.hour,
    });

    for (const { id } of tools.values()) await recomputeToolStatus(ctx, id);
    return { skipped: false, users: people.size, tools: tools.size, neighbourhood: SEED_NEIGHBORHOOD.label };
  },
});

/** Remove every seed-marked record (and records that hang off seed loans/tools). */
export const reset = internalMutation({
  args: { confirm: v.optional(v.boolean()) },
  handler: async (ctx) => {
    assertSeedEnabled();
    let removed = 0;
    const seedTools = await ctx.db.query("tools").withIndex("by_seed", (q) => q.eq("isSeed", true)).collect();
    const seedLoans = await ctx.db.query("loans").withIndex("by_seed", (q) => q.eq("isSeed", true)).collect();
    for (const loan of seedLoans) {
      for (const table of ["feedback", "damageReports", "otpVerifications", "returnSubmissions"] as const) {
        const rows =
          table === "feedback"
            ? await ctx.db.query("feedback").withIndex("by_loan_author", (q) => q.eq("loanId", loan._id)).collect()
            : await ctx.db.query(table).withIndex("by_loan", (q) => q.eq("loanId", loan._id)).collect();
        for (const r of rows) {
          await ctx.db.delete(r._id);
          removed++;
        }
      }
      await ctx.db.delete(loan._id);
      removed++;
    }
    // Requests on seed tools, including any made by real users.
    for (const tool of seedTools) {
      const requests = await ctx.db.query("borrowRequests").withIndex("by_tool_status", (q) => q.eq("toolId", tool._id)).collect();
      for (const r of requests) {
        if (r.loanId) {
          const loan = await ctx.db.get(r.loanId);
          if (loan) {
            await ctx.db.delete(loan._id);
            removed++;
          }
        }
        await ctx.db.delete(r._id);
        removed++;
      }
      const loc = await ctx.db.query("toolPickupLocations").withIndex("by_tool", (q) => q.eq("toolId", tool._id)).unique();
      if (loc) await ctx.db.delete(loc._id);
      for (const img of tool.imageIds) await ctx.storage.delete(img);
      await ctx.db.delete(tool._id);
      removed++;
    }
    const seedUsers = await ctx.db.query("users").withIndex("by_seed", (q) => q.eq("isSeed", true)).collect();
    for (const user of seedUsers) {
      const notes = await ctx.db.query("notifications").withIndex("by_user", (q) => q.eq("userId", user._id)).collect();
      for (const n of notes) await ctx.db.delete(n._id);
      await ctx.db.delete(user._id);
      removed++;
    }
    return { removed };
  },
});

/**
 * Re-sync the text of existing seed tools (descriptions, instructions, terms)
 * from the definitions above without touching loans, reviews or requests.
 *   npx convex run seed:refresh
 */
export const refresh = internalMutation({
  args: {},
  handler: async (ctx) => {
    assertSeedEnabled();
    const tools = await ctx.db.query("tools").withIndex("by_seed", (q) => q.eq("isSeed", true)).collect();
    let updated = 0;
    for (const spec of TOOLS) {
      const tool = tools.find((t) => t.name === spec.name);
      if (!tool) continue;
      await ctx.db.patch(tool._id, {
        description: spec.description,
        instructions: spec.instructions,
        lendingTerms: spec.terms,
        searchText: buildSearchText({ name: spec.name, category: spec.category, pickupArea: spec.area, description: spec.description }),
      });
      updated++;
    }
    return { updated };
  },
});

/** Upload URL for a demo photo (used by scripts/seed-images.mjs). */
export const imageUploadUrl = internalMutation({
  args: {},
  handler: async (ctx) => {
    assertSeedEnabled();
    return ctx.storage.generateUploadUrl();
  },
});

/** Attach uploaded demo photos (with attribution) to a seed tool, replacing previous ones. */
export const attachImages = internalMutation({
  args: {
    key: v.string(),
    storageIds: v.array(v.id("_storage")),
    credits: v.array(v.object({ creator: v.string(), license: v.string(), sourceUrl: v.string() })),
  },
  handler: async (ctx, { key, storageIds, credits }) => {
    assertSeedEnabled();
    const spec = TOOLS.find((t) => t.key === key);
    if (!spec) throw new Error(`Unknown seed tool key: ${key}`);
    const tools = await ctx.db.query("tools").withIndex("by_seed", (q) => q.eq("isSeed", true)).collect();
    const tool = tools.find((t) => t.name === spec.name);
    if (!tool) throw new Error(`Seed tool "${spec.name}" not found. Run seed:run first.`);
    for (const old of tool.imageIds) if (!storageIds.includes(old)) await ctx.storage.delete(old);
    await ctx.db.patch(tool._id, { imageIds: storageIds, imageCredits: credits });
    return { tool: spec.name, images: storageIds.length };
  },
});
