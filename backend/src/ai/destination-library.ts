import { CATALOG_SEED } from './destination-catalog.data';
import { DestinationFallbackCatalog, buildMatchers } from './destination-types';

export type {
  DestinationFallbackSpot,
  DestinationFallbackCatalog,
} from './destination-types';

export const DESTINATION_FALLBACK_LIBRARY: DestinationFallbackCatalog[] =
  CATALOG_SEED.map((seed) => ({
    matchers: buildMatchers(seed.keywords),
    spots: seed.spots,
  }));

export const DESTINATION_PLACE_ALIAS: Record<string, string> = {
  三寧坂: '二年坂・三年坂',
  産寧坂: '二年坂・三年坂',
  祇園花見小路通: '祇園花見小路',
  花見小路通: '祇園花見小路',
  雷門: '浅草寺',
  仲見世ストリート: '仲見世通り',
  'Tokyo Solamachi': '東京ソラマチ イーストヤード',
  伏見稲荷千本鳥居: '伏見稲荷大社 千本鳥居',
  稲荷山展望台: '稲荷山山頂展望台',
  道頓堀グリコ看板: '道頓堀グリコサイン前',
  札幌時計台: '札幌市時計台',
  兼六庭園: '兼六園',
  赤福: 'おかげ横丁 赤福本店',
  'Tokyo Cruise Asakusa Pier': '東京クルーズ 浅草乗り場',
  'Heian Shrine street': '祇園花見小路',
};
