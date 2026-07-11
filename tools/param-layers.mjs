export const PARAM_LAYERS = [
  { width: 6, height: 5, boxCount: 1, pullSteps: 10, minPushesFloor: 1, wallDensity: 0.08, goalClustering: false, seedIndexes: [1, 3] },
  { width: 7, height: 5, boxCount: 1, pullSteps: 16, minPushesFloor: 2, wallDensity: 0.1, goalClustering: false, seedIndexes: [9] },
  { width: 8, height: 6, boxCount: 2, pullSteps: 24, minPushesFloor: 4, wallDensity: 0.1, goalClustering: false, seedIndexes: [0, 10] },
  { width: 8, height: 6, boxCount: 2, pullSteps: 28, minPushesFloor: 4, wallDensity: 0.1, goalClustering: true, seedIndexes: [2] },
  { width: 9, height: 7, boxCount: 3, pullSteps: 34, minPushesFloor: 6, wallDensity: 0.08, goalClustering: false, seedIndexes: [3, 5] },
  { width: 9, height: 7, boxCount: 3, pullSteps: 36, minPushesFloor: 7, wallDensity: 0.08, goalClustering: true, seedIndexes: [8] },
  { width: 9, height: 7, boxCount: 3, pullSteps: 36, minPushesFloor: 8, maxPhiBarrierFloor: 1, wallDensity: 0.08, goalClustering: true, maxAttempts: 1000, seedIndexes: [2, 5] },
  { width: 9, height: 7, boxCount: 3, pullSteps: 40, minPushesFloor: 9, maxPhiBarrierFloor: 1, wallDensity: 0.06, goalClustering: true, maxAttempts: 1200, seedIndexes: [0, 6] },
];
