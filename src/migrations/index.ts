import * as migration_20261123_105517_initial from './20261123_105517_initial';
import * as migration_20261123_142818_boards_and_uploads from './20261123_142818_boards_and_uploads';

export const migrations = [
  {
    up: migration_20261123_105517_initial.up,
    down: migration_20261123_105517_initial.down,
    name: '20261123_105517_initial',
  },
  {
    up: migration_20261123_142818_boards_and_uploads.up,
    down: migration_20261123_142818_boards_and_uploads.down,
    name: '20261123_142818_boards_and_uploads'
  },
];
