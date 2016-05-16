from django.http import HttpResponse
from django.db import connection

def save_ajax(request):
    cursor = connection.cursor()
    cursor.execute("INSERT INTO codings_values (coding_id,field_id,intval) VALUES (34,"+request.POST.get("fieldID", "")+","+request.POST.get("fieldValueID", "")+")")
    
    ''' cursor.execute("SELECT col1, col2 FROM test WHERE col1='433'")
    row = cursor.fetchone()
    if len(row):
        return HttpResponse(row[0])
    else:
        return HttpResponse("No Record")
    '''
    return HttpResponse("Done!"+request.POST.get("fieldID", "")+"--"+request.POST.get("fieldValueID", ""))