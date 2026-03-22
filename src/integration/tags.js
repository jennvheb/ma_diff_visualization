export const DIFF_BOUNDARY_TAGS = new Set([
    "call", "loop", "choose", "parallel",
    "manipulate", "otherwise", "alternative",
    "parallel_branch", "stop", "method"
]);


export const BRANCH_CONTAINER_TAGS = new Set(["parallel_branch", "otherwise", "alternative"]);

export const CONDITION_TAGS = new Set([
    "condition", "_condition", "guard", "_guard", "test"
]);

// containers that should be treated as moveable as a whole
export const GATEWAY_TAGS = new Set([
    "loop",
    "choose",
    "parallel",
    "stop"
]);

export const NON_STRUCTURAL_MOVE_TAGS = new Set([
    "annotations",
    "arguments",
    "parameters",
    "parameter",
    "method",
    "endpoint",
    "label",
    "_probability",
    "_probability_min",
    "_probability_max",
    "_probability_avg",
    "_text",
    "lang",
    "lx",
    "ly"
]);

export const STRUCTURAL_TAGS = new Set([
    "call", "loop", "choose", "parallel", "manipulate", "stop",
    "parallel_branch", "otherwise", "alternative"
]);