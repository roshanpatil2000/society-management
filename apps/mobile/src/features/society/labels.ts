import type { TFunction } from 'i18next';

import type { OccupantType } from './api';

export const occupantLabel = (t: TFunction, type: OccupantType) => t(`occupant.${type}`);
