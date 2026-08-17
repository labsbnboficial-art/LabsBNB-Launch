import EventEmitter3, { EventEmitter as NamedEventEmitter3 } from "eventemitter3";
import { EventEmitter as NodeEventEmitter } from "events";

export function auditEventResolution() {
  return {
    eventemitter3Named: new NamedEventEmitter3() instanceof EventEmitter3,
    eventemitter3Constructor: NamedEventEmitter3.name,
    nodeEventsNamed: typeof new NodeEventEmitter().emit === "function",
    nodeEventsConstructor: NodeEventEmitter.name,
  };
}