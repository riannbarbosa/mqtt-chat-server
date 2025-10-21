export interface User {
  id: string;
  name: string;
  status: 'online' | 'offline';
}

export interface Group {
  name: string;
  leader: string;
  members: string[];
  topic: string;
}

export interface ConversationRequest {
  from: string;
  to: string;
  timestamp: number;
  status: 'pendente' | 'aceito' | 'rejeitado';
  topic?: string;
}

export interface GroupInvitation {
  type: 'group_invitation';
  groupName: string;
  from: string;
  to: string;
  timestamp: number;
}

export interface GroupJoinRequest {
  type: 'group_request';
  groupName: string;
  from: string;
  to: string;
  timestamp: number;
}

export interface GroupMessage {
  type: 'group_request';
  groupName: string;
  from: string;
  message: string;
  timestamp: number;
}
