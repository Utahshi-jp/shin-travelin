import { z } from "zod";

const activitySchema = z.object({
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "HH:mm" }),
  location: z.string().min(1).max(200),
  content: z.string().min(1).max(500),
  url: z.string().url().max(500).optional().or(z.literal("")),
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
