import { z } from "zod";

// Mirrors FR-1 input constraints so client-side prevents invalid submission before hitting API.
export const draftFormSchema = z.object({
  origin: z.string().min(3).max(200),
  destinations: z.array(z.string().min(3).max(200)).min(1).max(5),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  budget: z.number().min(5000).max(5_000_000),
  purposes: z.array(z.string().min(1)).min(1).max(5),
  memo: z.string().max(500).optional().or(z.literal("")),
  companions: z.object({
    adultMale: z.number().min(0).max(20),
    adultFemale: z.number().min(0).max(20),
    boy: z.number().min(0).max(20),
    girl: z.number().min(0).max(20),
    infant: z.number().min(0).max(20),
    pet: z.number().min(0).max(20),
    other: z.number().min(0).max(20),
  }),
});

export type DraftFormValues = z.infer<typeof draftFormSchema>;
