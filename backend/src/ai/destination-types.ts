import { SpotCategory } from '@prisma/client';

export type DestinationFallbackSpot = {
  placeName?: string;
  area: string;
  category: SpotCategory;
  description: string;
  stayMinutes: number;
};

export type DestinationFallbackCatalog = {
  matchers: RegExp[];
  spots: DestinationFallbackSpot[];
};

export type CatalogSeed = {
  keywords: string[];
  spots: DestinationFallbackSpot[];
};

export const buildMatchers = (keywords: string[]): RegExp[] =>
  keywords.map((keyword) =>
    /^[A-Za-z0-9\s'-]+$/.test(keyword)
      ? new RegExp(keyword, 'i')
      : new RegExp(keyword, 'u'),
  );
