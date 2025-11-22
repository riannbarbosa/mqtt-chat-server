import { Table } from 'console-table-printer';

export const generateTable = (obj: Record<string, any>[]) => {
  const tableGraph = new Table();
  const returnDataGraph = tableGraph.addRows(obj);
  return returnDataGraph;
};
