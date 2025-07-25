import { Box, Text } from '@chakra-ui/react'

const DashboardPage = () => {
  return (
    <Box p={8}>
      <Text fontSize="2xl" fontWeight="bold" mb={4}>
        Welcome to Kingdom SaaS Dashboard
      </Text>
      <Text color="gray.600">
        Your AI-powered business platform is ready to use!
      </Text>
    </Box>
  )
}

export default DashboardPage