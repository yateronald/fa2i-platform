'use client';
import { use } from 'react';
import ElectionManager from '@/components/election/ElectionManager';

export default function AssociationElectionDetailPage({ params }) {
  const { id, electionId } = use(params);
  return <ElectionManager electionId={electionId} />;
}
