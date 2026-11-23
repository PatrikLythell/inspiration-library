import * as migration_20261123_105517_initial from './20261123_105517_initial';

export const migrations = [
  {
    up: migration_20261123_105517_initial.up,
    down: migration_20261123_105517_initial.down,
    name: '20261123_105517_initial'
  },
];
