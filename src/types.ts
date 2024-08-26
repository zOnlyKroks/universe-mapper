// types.ts

export interface SystemJump {
  ship_jumps: number;
  system_id: number;
}

export interface SystemKill {
  npc_kills: number;
  pod_kills: number;
  ship_kills: number;
  system_id: number;
}

export interface SystemKills {
  data: SystemKill[]
}

export interface SystemJumps {
  data: SystemJump[]
}

export interface Planet {
  planet_id: number;
  asteroid_belts: number[];
  moons: number[];
}

export interface Position {
  x: number;
  y: number;
  z: number;
}

export interface PlanetInfo {
  name: string,
  planed_id : number,
  system_id: number,
  type_id: number
}

export interface SystemInfo {
  constellation_id: number;
  name: string;
  planets: Planet[];
  position: Position;
  security_class: string | null;
  security_status: number;
  star_id: number;
  stargates: number[];
  stations: number[];
  system_id: number;
}

export interface CombinedSystemData extends SystemInfo {
  ship_jumps: number;
  npc_kills: number;
  pod_kills: number;
  ship_kills: number;
}
