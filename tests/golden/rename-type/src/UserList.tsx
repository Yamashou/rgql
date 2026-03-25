import { graphql } from "./gql";

const UsersQuery = graphql`
  query GetUsers {
    users {
      id
      name
      email
    }
  }
`;

const UserFragment = graphql`
  fragment UserFields on Account {
    id
    name
    email
  }
`;

export function UserList() {
  return <div>User List</div>;
}
