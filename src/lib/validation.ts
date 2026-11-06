/**
 * Client-side form schemas. These mirror the backend rules for instant
 * feedback; the Convex mutations remain the authority and re-validate.
 */
import { z } from "zod";
import { FEEDBACK_TAGS, LIMITS, TOOL_CATEGORIES, TOOL_CONDITIONS } from "@convex/lib/constants";
import { combineDateTime } from "./format";

const optionalText = (max: number) => z.string().trim().max(max, `At most ${max} characters`).optional().or(z.literal(""));

export const toolFormSchema = z
  .object({
    name: z.string().trim().min(LIMITS.toolNameMin, "At least 3 characters").max(LIMITS.toolNameMax),
    category: z.enum(TOOL_CATEGORIES),
    condition: z.enum(TOOL_CONDITIONS),
    description: z
      .string()
      .trim()
      .min(LIMITS.descriptionMin, `At least ${LIMITS.descriptionMin} characters`)
      .max(LIMITS.descriptionMax),
    pickupArea: z.string().trim().min(2, "Name the neighbourhood").max(LIMITS.areaMax),
    pickupLat: z.number({ error: "Set the pickup point on the map" }).min(-90).max(90),
    pickupLng: z.number({ error: "Set the pickup point on the map" }).min(-180).max(180),
    pickupAddress: optionalText(LIMITS.addressMax),
    instructions: optionalText(LIMITS.instructionsMax),
    lendingTerms: optionalText(LIMITS.termsMax),
    depositAmount: z.union([z.number().min(0).max(100000), z.nan()]).optional(),
    maxLoanDays: z.number({ error: "Required" }).int().min(1).max(LIMITS.maxLoanDaysCeiling),
    availableFrom: z.string().optional(),
    availableUntil: z.string().optional(),
  })
  .refine((v) => !v.availableFrom || !v.availableUntil || v.availableUntil > v.availableFrom, {
    path: ["availableUntil"],
    message: "Must be after the start date",
  });

export type ToolFormValues = z.infer<typeof toolFormSchema>;

export function borrowRequestSchema(maxLoanDays: number) {
  return z
    .object({
      startDate: z.string().min(1, "Choose a date"),
      pickupTime: z.string().min(1, "Choose a time"),
      endDate: z.string().min(1, "Choose a date"),
      returnTime: z.string().min(1, "Choose a time"),
      message: z.string().trim().max(LIMITS.messageMax).optional(),
    })
    .superRefine((v, ctx) => {
      const start = combineDateTime(v.startDate, v.pickupTime);
      const end = combineDateTime(v.endDate, v.returnTime);
      if (start < Date.now() - 5 * 60_000) {
        ctx.addIssue({ code: "custom", path: ["startDate"], message: "Pick-up can't be in the past" });
      }
      if (end <= start) {
        ctx.addIssue({ code: "custom", path: ["endDate"], message: "Return must be after pick-up" });
      } else if (end - start > maxLoanDays * 86_400_000) {
        ctx.addIssue({
          code: "custom",
          path: ["endDate"],
          message: `Up to ${maxLoanDays} day${maxLoanDays === 1 ? "" : "s"} for this tool`,
        });
      }
    });
}

export type BorrowRequestValues = z.infer<ReturnType<typeof borrowRequestSchema>>;

export const feedbackSchema = z.object({
  rating: z.number().int().min(1, "Choose a rating").max(5),
  comment: z.string().trim().max(LIMITS.feedbackCommentMax).optional(),
  tags: z.array(z.enum(FEEDBACK_TAGS)).max(5),
});
export type FeedbackValues = z.infer<typeof feedbackSchema>;

export const profileSchema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(LIMITS.nameMax),
  bio: z.string().trim().max(LIMITS.bioMax).optional(),
  areaLabel: z.string().trim().max(LIMITS.areaMax).optional(),
  locationSharing: z.boolean(),
});
export type ProfileValues = z.infer<typeof profileSchema>;

export const reasonSchema = (min: number, max: number = LIMITS.reasonMax) =>
  z.object({ text: z.string().trim().min(min, `At least ${min} characters`).max(max) });
