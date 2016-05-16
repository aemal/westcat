from django.http import HttpResponse
from django.db import connection

def hello(request):
	from django.db import connection,transaction
	cursor = connection.cursor()



	query=''' INSERT INTO test 
			(col1,col2) 
			VALUES (%s,%s) '''


	#queryList=buildQueryList() 
	queryList=[('a', 'b')] 

	#here buildQueryList() represents some function to populate
	#the list with multiple records
	#in the tuple format (value1,value2,value3).


	cursor.executemany(query,queryList)

	transaction.commit()
    return HttpResponse('Hello World!')