import { z } from "zod";

const spotCategorySchema = z.enum(["FOOD", "SIGHTSEEING", "MOVE", "REST", "STAY", "SHOPPING", "OTHER"]);

const activitySchema = z.object({
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "HH:mm" }),
  area: z.string().min(1).max(200),
  placeName: z
    .string()
    .max(200)
    .nullable()
    .optional(),
  category: spotCategorySchema,
  description: z.string().min(1).max(500),
  stayMinutes: z
    .number()
    .int()
    .min(5)
    .max(1440)
    .nullable()
    .optional(),
  weather: z.string().min(3).max(20),
  orderIndex: z.number().min(0),
});

export const itinerarySchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(120),
  version: z.number().min(1),
  days: z.array(
    z.object({
      id: z.string().optional(),
      dayIndex: z.number().min(0),
      date: z.string(),
      scenario: z.enum(["SUNNY", "RAINY"]),
      activities: z.array(activitySchema),
    }),
  ),
});

export type ItineraryFormValues = z.infer<typeof itinerarySchema>;
