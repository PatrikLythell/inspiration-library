import * as migration_20261123_105517_initial from './20261123_105517_initial';
import * as migration_20261123_142818_boards_and_uploads from './20261123_142818_boards_and_uploads';
import * as migration_20261124_085816_lean_storage from './20261124_085816_lean_storage';
import * as migration_20261124_102917_moodboards from './20261124_102917_moodboards';

export const migrations = [
  {
    up: migration_20261123_105517_initial.up,
    down: migration_20261123_105517_initial.down,
    name: '20261123_105517_initial',
  },
  {
    up: migration_20261123_142818_boards_and_uploads.up,
    down: migration_20261123_142818_boards_and_uploads.down,
    name: '20261123_142818_boards_and_uploads',
  },
  {
    up: migration_20261124_085816_lean_storage.up,
    down: migration_20261124_085816_lean_storage.down,
    name: '20261124_085816_lean_storage',
  },
  {
    up: migration_20261124_102917_moodboards.up,
    down: migration_20261124_102917_moodboards.down,
    name: '20261124_102917_moodboards'
  },
];
