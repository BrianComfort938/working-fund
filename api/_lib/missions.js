const MISSIONS = ["east", "south", "north"];
const DEFAULT_MISSION = "east";

const isMission = (m) => MISSIONS.indexOf(m) !== -1;
const normMission = (m) => (isMission(m) ? m : DEFAULT_MISSION);

module.exports = { MISSIONS, isMission, normMission };
