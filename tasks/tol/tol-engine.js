(function attachTolEngine(root) {
  "use strict";

  const BALLS = ["red", "blue", "yellow"];
  const CAPACITIES = [3, 2, 1];

  function permutations(items) {
    if (items.length <= 1) return [items.slice()];
    return items.flatMap((item, index) => permutations(items.filter((_, position) => position !== index)).map((tail) => [item, ...tail]));
  }

  function key(state) { return state.map((peg) => peg.join(",")).join("|"); }
  function clone(state) { return state.map((peg) => peg.slice()); }

  function allStates() {
    const byKey = new Map();
    permutations(BALLS).forEach((order) => {
      for (let first = 0; first <= CAPACITIES[0]; first += 1) {
        for (let second = 0; second <= CAPACITIES[1]; second += 1) {
          const third = BALLS.length - first - second;
          if (third < 0 || third > CAPACITIES[2]) continue;
          const state = [order.slice(0, first), order.slice(first, first + second), order.slice(first + second)];
          byKey.set(key(state), state);
        }
      }
    });
    return Array.from(byKey.values());
  }

  function neighbors(state) {
    const results = [];
    for (let source = 0; source < state.length; source += 1) {
      if (!state[source].length) continue;
      for (let destination = 0; destination < state.length; destination += 1) {
        if (source === destination || state[destination].length >= CAPACITIES[destination]) continue;
        const next = clone(state);
        next[destination].push(next[source].pop());
        results.push({ state: next, source, destination });
      }
    }
    return results;
  }

  function distance(start, goal) {
    const goalKey = key(goal);
    if (key(start) === goalKey) return 0;
    const queue = [{ state: clone(start), depth: 0 }];
    const seen = new Set([key(start)]);
    while (queue.length) {
      const current = queue.shift();
      for (const next of neighbors(current.state)) {
        const nextKey = key(next.state);
        if (seen.has(nextKey)) continue;
        if (nextKey === goalKey) return current.depth + 1;
        seen.add(nextKey); queue.push({ state: next.state, depth: current.depth + 1 });
      }
    }
    return null;
  }

  function distancesFrom(start) {
    const result = new Map([[key(start), 0]]);
    const queue = [clone(start)];
    while (queue.length) {
      const current = queue.shift();
      const nextDepth = result.get(key(current)) + 1;
      for (const next of neighbors(current)) {
        const nextKey = key(next.state);
        if (result.has(nextKey)) continue;
        result.set(nextKey, nextDepth); queue.push(next.state);
      }
    }
    return result;
  }

  function move(state, source, destination) {
    if (source === destination || !state[source]?.length || state[destination]?.length >= CAPACITIES[destination]) return null;
    const next = clone(state);
    next[destination].push(next[source].pop());
    return next;
  }

  root.TolEngine = { BALLS, CAPACITIES, allStates, clone, distance, distancesFrom, key, move, neighbors };
})(typeof window !== "undefined" ? window : globalThis);
