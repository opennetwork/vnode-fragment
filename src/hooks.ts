import { hooks, VNodeHook, VNodeHooks, VNodeChildrenHooks } from "@opennetwork/vnode-hooks";
import { FragmentVNode, VNode } from "@opennetwork/vnode";
import { isMutationFragmentVNode, isMutationFragmentVNodeForVNode, MutationFragmentVNode } from "./mutation";
import { isReferenceFragmentVNode, isReferenceFragmentVNodeForVNode, ReferenceFragmentVNode } from "./reference";
import { asyncHooks } from "iterable";
import { isIsolatedFragmentVNode, IsolatedFragmentVNode } from "./isolated";

export function hookFragments(fragments: FragmentVNodeDescriptor[] = [], depth: number = 0): VNodeHook {
  return hooks(fragmentHooks(fragments, depth));
}

function fragmentHooks(fragments: FragmentVNodeDescriptor[] = [], depth: number = 0): VNodeHooks & { yield: unknown } {
  return {
    async yield(node) {
      if (isMutationFragmentVNode(node) || isReferenceFragmentVNode(node) || isIsolatedFragmentVNode(node)) {
        if (!node.children) {
          // We will never utilise the fragments, so we can ignore them for now
          return node;
        }
        const nextHook = asyncHooks(fragmentChildrenHooks(fragments.concat({ fragment: node, depth })));
        return {
          ...node,
          children: nextHook(node.children)
        };
      }
      const nextHook = asyncHooks(fragmentChildrenHooks(fragments));
      // Do something with our
      const nextNode = await run(node, fragments, depth);
      if (!nextNode.children) {
        return nextNode;
      }
      return {
        ...nextNode,
        children: nextHook(nextNode.children)
      };
    }
  };
}

function fragmentChildrenHooks(fragments: FragmentVNodeDescriptor[] = [], depth: number = 0): VNodeChildrenHooks & { yield: unknown } {
  return {
    yield(children) {
      // Will "just work", in this case we have a list of children, rather than updates for the same VNode
      return hookFragments(fragments, depth + 1)(children);
    }
  };
}

async function run<V extends VNode = VNode>(node: V, fragments: FragmentVNodeDescriptor[] = [], depth: number): Promise<VNode> {
  if (!fragments.length) {
    return node;
  }

  const isolated = fragments.filter(isIsolatedFragmentVNodeDescriptor);

  const isolatedDepth = isolated.reduce(
    (depth, descriptor) => Math.min(depth, descriptor.depth),
    Number.POSITIVE_INFINITY
  );

  function isAllowedDepth(descriptor: FragmentVNodeDescriptor) {
    if (isolatedDepth === Number.POSITIVE_INFINITY) {
      return true;
    }
    return descriptor.depth >= isolatedDepth;
  }

  const mutators = fragments
    .filter(isMutationFragmentVNodeDescriptor)
    .filter(isAllowedDepth);

  const references = fragments
    .filter(isReferenceFragmentVNodeDescriptor)
    .filter(isAllowedDepth);

  // Reference before we mutate
  await reference(node, references);

  const mutated = await mutate(node, mutators);

  // If _any_ change is made then we will re-invoke our references
  // This is a very important point that we may invoke reference fragments multiple times with the same vnode
  //
  // The implementation will need to track whether the reference was found before
  //
  // Mutators should only be returning a new node instance if they have a change!
  if (mutated !== node) {
    await reference(mutated, references);
  }

  return mutated;

  function reference<V extends VNode>(node: V, fragments: FragmentVNodeDescriptor<ReferenceFragmentVNode>[]) {
    // Invoke all at once
    return Promise.all(
      fragments
        .map(
          descriptor => descriptor.fragment
        )
        .filter(
          (fragment): fragment is ReferenceFragmentVNode<V> => isReferenceFragmentVNodeForVNode(fragment, node)
        )
        .map(fragment => fragment.options.on(node))
    );
  }

  async function mutate(node: VNode, mutators: FragmentVNodeDescriptor<MutationFragmentVNode>[]): Promise<VNode> {
    if (!mutators.length) {
      return node;
    }
    const currentMutators = mutators.slice();
    const nextMutator = currentMutators.shift();
    if (!isMutationFragmentVNodeForVNode(nextMutator.fragment, node)) {
      return mutate(node, currentMutators);
    }
    const nextValue = await nextMutator.fragment.options.mutate(node);
    return mutate(nextValue, mutators);
  }
}


interface FragmentVNodeDescriptor<Fragment extends FragmentVNode = FragmentVNode> {
  fragment: Fragment;
  depth: number;
}

export function isIsolatedFragmentVNodeDescriptor(descriptor: FragmentVNodeDescriptor): descriptor is FragmentVNodeDescriptor<IsolatedFragmentVNode> {
  return isIsolatedFragmentVNode(descriptor.fragment);
}

export function isMutationFragmentVNodeDescriptor(descriptor: FragmentVNodeDescriptor): descriptor is FragmentVNodeDescriptor<MutationFragmentVNode> {
  return isMutationFragmentVNode(descriptor.fragment);
}

export function isReferenceFragmentVNodeDescriptor(descriptor: FragmentVNodeDescriptor): descriptor is FragmentVNodeDescriptor<ReferenceFragmentVNode> {
  return isReferenceFragmentVNode(descriptor.fragment);
}
