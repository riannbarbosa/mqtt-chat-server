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
  topic?: string;
  timestamp: number;
}

export interface GroupJoinRequest {
  type: 'group_join_request';
  groupName: string;
  from: string;
  to: string;
  timestamp: number;
}

export interface GroupMessage {
  type: 'group_message';
  groupName: string;
  from: string;
  message: string;
  timestamp: number;
}

export interface GroupJoinResponse {
  type: 'group_join_response';
  groupName: string;
  from: string;
  to: string;
  status: 'aceito' | 'rejeitado';
  topic?: string;
  timestamp: number;
}

export interface GroupUpdate {
  type: 'group_created' | 'group_updated';
  name: string;
  leader: string;
  members: string[];
  topic: string;
  timestamp: number;
}
