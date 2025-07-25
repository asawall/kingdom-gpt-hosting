import { Box, Flex } from '@chakra-ui/react'
import { ReactNode } from 'react'

interface LayoutProps {
  children: ReactNode
}

const Layout = ({ children }: LayoutProps) => {
  return (
    <Flex minH="100vh" bg="gray.50">
      <Box flex="1">
        {children}
      </Box>
    </Flex>
  )
}

export default Layout